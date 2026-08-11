import { FastifyInstance } from "fastify";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import {
  AuthClaims,
  authenticate,
  requirePermission,
} from "../../auth/authorization";
import { writeAuditEvent } from "../../audit/audit";
import argon2 from "argon2";

export async function userRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * GET /api/users
   */
  app.get("/api/users", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "user.view",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const users = await prisma.user.findMany({
      where: {
        tenantId: claims.tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        roles: {
          select: {
            role: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        email: "asc",
      },
    });

    return {
      data: users,
    };
  });

  /*
   * GET /api/users/:id
   */
  app.get("/api/users/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "user.view",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const params = request.params as {
      id: string;
    };

    const user = await prisma.user.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        organizationId: true,
        organization: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        roles: {
          select: {
            role: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "User not found",
          },
        ],
      });
    }

    return {
      data: user,
    };
  });

  /*
   * POST /api/users
   */
  app.post("/api/users", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "user.create",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const body = request.body as {
      email?: string;
      name?: string;
      password?: string;
      organizationId?: string | null;
      roleId?: string | null;
    };

    if (!body.email || !body.name || !body.password) {
      return reply.code(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message:
              "email, name and password are required",
          },
        ],
      });
    }

    if (body.password.length < 12) {
      return reply.code(400).send({
        errors: [
          {
            code: "WEAK_PASSWORD",
            message:
              "Password must contain at least 12 characters",
          },
        ],
      });
    }

    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findFirst({
      where: {
        tenantId: claims.tenantId,
        email,
      },
    });

    if (existing) {
      return reply.code(409).send({
        errors: [
          {
            code: "DUPLICATE_EMAIL",
            message: "User email already exists",
          },
        ],
      });
    }

    if (body.organizationId) {
      const organization = await prisma.organization.findFirst({
        where: {
          id: body.organizationId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!organization) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_ORGANIZATION",
              message: "Organization is invalid",
            },
          ],
        });
      }
    }

    if (body.roleId) {
      const role = await prisma.role.findFirst({
        where: {
          id: body.roleId,
          tenantId: claims.tenantId,
        },
      });

      if (!role) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_ROLE",
              message: "Role is invalid",
            },
          ],
        });
      }
    }

    const passwordHash = await argon2.hash(body.password);

    const user = await prisma.user.create({
      data: {
        tenantId: claims.tenantId,
        organizationId: body.organizationId ?? null,
        email,
        name: body.name.trim(),
        passwordHash,
        status: "ACTIVE",
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (body.roleId) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: body.roleId,
        },
      });
    }

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      newState: {
        ...user,
        roleId: body.roleId ?? null,
      },
    });

    return reply.code(201).send({
      data: user,
    });
  });

  /*
   * PATCH /api/users/:id
   */
  app.patch("/api/users/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "user.update",
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
      organizationId?: string | null;
    };

    const existing = await prisma.user.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        organizationId: true,
      },
    });

    if (!existing) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "User not found",
          },
        ],
      });
    }

    if (body.organizationId) {
      const organization = await prisma.organization.findFirst({
        where: {
          id: body.organizationId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!organization) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_ORGANIZATION",
              message: "Organization is invalid",
            },
          ],
        });
      }
    }

    const user = await prisma.user.update({
      where: {
        id: existing.id,
      },
      data: {
        ...(body.name !== undefined
          ? { name: body.name.trim() }
          : {}),
        ...(body.organizationId !== undefined
          ? { organizationId: body.organizationId }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      previousState: existing,
      newState: user,
    });

    return {
      data: user,
    };
  });

  /*
   * POST /api/users/:id/disable
   */
  app.post(
    "/api/users/:id/disable",
    async (request, reply) => {
      const authResult = await authenticate(request, reply);

      if (authResult) {
        return authResult;
      }

      const permissionResult = await requirePermission(
        request,
        reply,
        "user.disable",
      );

      if (permissionResult) {
        return permissionResult;
      }

      const claims = request.user as AuthClaims;

      const params = request.params as {
        id: string;
      };

      const existing = await prisma.user.findFirst({
        where: {
          id: params.id,
          tenantId: claims.tenantId,
        },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          organizationId: true,
        },
      });

      if (!existing) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "User not found",
            },
          ],
        });
      }

      if (existing.id === claims.sub) {
        return reply.code(400).send({
          errors: [
            {
              code: "SELF_DISABLE",
              message: "You cannot disable your own account",
            },
          ],
        });
      }

      const user = await prisma.user.update({
        where: {
          id: existing.id,
        },
        data: {
          status: "DISABLED",
        },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          organizationId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "DISABLE",
        entityType: "User",
        entityId: user.id,
        previousState: existing,
        newState: user,
      });

      return {
        data: user,
      };
    },
  );
}
