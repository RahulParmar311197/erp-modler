import { FastifyInstance } from "fastify";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import {
  AuthClaims,
  authenticate,
  requirePermission,
} from "../../auth/authorization";
import { writeAuditEvent } from "../../audit/audit";

export async function organizationRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * GET /api/organizations
   */
  app.get("/api/organizations", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const claims = request.user as AuthClaims;

    const organizations = await prisma.organization.findMany({
      where: {
        tenantId: claims.tenantId,
      },
      orderBy: {
        code: "asc",
      },
    });

    return {
      data: organizations,
    };
  });

  /*
   * GET /api/organizations/:id
   */
  app.get("/api/organizations/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const claims = request.user as AuthClaims;

    const params = request.params as {
      id: string;
    };

    const organization = await prisma.organization.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
    });

    if (!organization) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "Organization not found",
          },
        ],
      });
    }

    return {
      data: organization,
    };
  });

  /*
   * POST /api/organizations
   */
  app.post("/api/organizations", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "organization.create",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const body = request.body as {
      code?: string;
      name?: string;
      type?:
        | "LEGAL_ENTITY"
        | "BUSINESS_UNIT"
        | "DIVISION"
        | "DEPARTMENT"
        | "SITE"
        | "BRANCH";
      parentId?: string;
    };

    if (!body.code || !body.name || !body.type) {
      return reply.code(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "code, name and type are required",
          },
        ],
      });
    }

    const existing = await prisma.organization.findFirst({
      where: {
        tenantId: claims.tenantId,
        code: body.code,
      },
    });

    if (existing) {
      return reply.code(409).send({
        errors: [
          {
            code: "DUPLICATE_CODE",
            message: "Organization code already exists",
          },
        ],
      });
    }

    if (body.parentId) {
      const parent = await prisma.organization.findFirst({
        where: {
          id: body.parentId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!parent) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_PARENT",
              message: "Parent organization is invalid",
            },
          ],
        });
      }
    }

    const organization = await prisma.organization.create({
      data: {
        tenantId: claims.tenantId,
        parentId: body.parentId,
        code: body.code,
        name: body.name,
        type: body.type,
      },
    });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "CREATE",
      entityType: "Organization",
      entityId: organization.id,
      newState: organization,
    });

    return reply.code(201).send({
      data: organization,
    });
  });

  /*
   * PATCH /api/organizations/:id
   */
  app.patch("/api/organizations/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "organization.update",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const params = request.params as {
      id: string;
    };

    const body = request.body as {
      name?: string;
      active?: boolean;
      parentId?: string | null;
    };

    const existing = await prisma.organization.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
    });

    if (!existing) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "Organization not found",
          },
        ],
      });
    }

    if (body.parentId) {
      if (body.parentId === params.id) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_PARENT",
              message: "Organization cannot be its own parent",
            },
          ],
        });
      }

      const parent = await prisma.organization.findFirst({
        where: {
          id: body.parentId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!parent) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_PARENT",
              message: "Parent organization is invalid",
            },
          ],
        });
      }
    }

    const organization = await prisma.organization.update({
      where: {
        id: params.id,
      },
      data: {
        ...(body.name !== undefined
          ? { name: body.name }
          : {}),
        ...(body.active !== undefined
          ? { active: body.active }
          : {}),
        ...(body.parentId !== undefined
          ? { parentId: body.parentId }
          : {}),
      },
    });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "UPDATE",
      entityType: "Organization",
      entityId: organization.id,
      previousState: existing,
      newState: organization,
    });

    return {
      data: organization,
    };
  });

  /*
   * DELETE /api/organizations/:id
   *
   * ERP policy:
   * Do not physically delete an organization.
   * Deactivate it instead.
   */
  app.delete("/api/organizations/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "organization.delete",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const params = request.params as {
      id: string;
    };

    const existing = await prisma.organization.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
    });

    if (!existing) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "Organization not found",
          },
        ],
      });
    }

    const organization = await prisma.organization.update({
      where: {
        id: params.id,
      },
      data: {
        active: false,
      },
    });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "DELETE",
      entityType: "Organization",
      entityId: organization.id,
      previousState: existing,
      newState: organization,
    });

    return {
      data: organization,
    };
  });
}
