import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

import {
  authenticate,
  requirePermission,
  AuthClaims,
} from "../../auth/authorization";

import { writeAuditEvent } from "../../audit/audit";

export async function warehouseRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  app.get(
    "/api/warehouses",
    {
      preHandler: [
        authenticate,
        async (
          request: FastifyRequest,
          reply: FastifyReply,
        ) => {
          return requirePermission(
            request,
            reply,
            "organization.view",
          );
        },
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const warehouses =
        await prisma.warehouse.findMany({
          where: {
            tenantId: claims.tenantId,
          },
          orderBy: {
            code: "asc",
          },
          include: {
            organization: true,
            location: true,
          },
        });

      return {
        data: warehouses,
      };
    },
  );

  app.post(
    "/api/warehouses",
    {
      preHandler: [
        authenticate,
        async (
          request: FastifyRequest,
          reply: FastifyReply,
        ) => {
          return requirePermission(
            request,
            reply,
            "organization.create",
          );
        },
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        code?: string;
        name?: string;
        locationId?: string;
        organizationId?: string;
        warehouseType?: string;
      };

      if (
        !body.code ||
        !body.name ||
        !body.locationId
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "code, name and locationId are required",
            },
          ],
        });
      }

      const location =
        await prisma.location.findFirst({
          where: {
            id: body.locationId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!location) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Location does not exist or is inactive",
            },
          ],
        });
      }

      if (body.organizationId) {
        const organization =
          await prisma.organization.findFirst({
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
                code: "VALIDATION_ERROR",
                message:
                  "Organization does not exist or is inactive",
              },
            ],
          });
        }
      }

      const existing =
        await prisma.warehouse.findFirst({
          where: {
            tenantId: claims.tenantId,
            code: body.code,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message:
                "Warehouse code already exists",
            },
          ],
        });
      }

      const warehouse =
        await prisma.warehouse.create({
          data: {
            tenantId: claims.tenantId,
            organizationId:
              body.organizationId,
            locationId: body.locationId,
            code: body.code,
            name: body.name,
            warehouseType:
              body.warehouseType ?? "STANDARD",
          },
          include: {
            organization: true,
            location: true,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "Warehouse",
        entityId: warehouse.id,
        newState: warehouse,
      });

      return reply.code(201).send({
        data: warehouse,
      });
    },
  );


  app.put(
    "/api/warehouses/:id",
    {
      preHandler: [
        authenticate,
        async (
          request: FastifyRequest,
          reply: FastifyReply,
        ) => {
          return requirePermission(
            request,
            reply,
            "warehouse.update",
          );
        },
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const body = request.body as {
        code?: string;
        name?: string;
        locationId?: string;
        organizationId?: string | null;
        warehouseType?: string;
        active?: boolean;
      };

      const existing =
        await prisma.warehouse.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
        });

      if (!existing) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Warehouse not found",
            },
          ],
        });
      }

      if (
        body.code !== undefined &&
        body.code !== existing.code
      ) {
        const duplicate =
          await prisma.warehouse.findFirst({
            where: {
              tenantId: claims.tenantId,
              code: body.code,
              id: { not: id },
            },
          });

        if (duplicate) {
          return reply.code(409).send({
            errors: [
              {
                code: "DUPLICATE_ERROR",
                message:
                  "Warehouse code already exists",
              },
            ],
          });
        }
      }

      if (body.locationId !== undefined) {
        const location =
          await prisma.location.findFirst({
            where: {
              id: body.locationId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!location) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Location does not exist or is inactive",
              },
            ],
          });
        }
      }

      if (body.organizationId) {
        const organization =
          await prisma.organization.findFirst({
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
                code: "VALIDATION_ERROR",
                message:
                  "Organization does not exist or is inactive",
              },
            ],
          });
        }
      }

      const warehouse =
        await prisma.warehouse.update({
          where: { id },
          data: {
            ...(body.code !== undefined && {
              code: body.code,
            }),
            ...(body.name !== undefined && {
              name: body.name,
            }),
            ...(body.locationId !== undefined && {
              locationId: body.locationId,
            }),
            ...(body.organizationId !== undefined && {
              organizationId: body.organizationId,
            }),
            ...(body.warehouseType !== undefined && {
              warehouseType: body.warehouseType,
            }),
            ...(body.active !== undefined && {
              active: body.active,
            }),
          },
          include: {
            organization: true,
            location: true,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "Warehouse",
        entityId: warehouse.id,
        previousState: existing,
        newState: warehouse,
      });

      return {
        data: warehouse,
      };
    },
  );

  app.delete(
    "/api/warehouses/:id",
    {
      preHandler: [
        authenticate,
        async (
          request: FastifyRequest,
          reply: FastifyReply,
        ) => {
          return requirePermission(
            request,
            reply,
            "warehouse.delete",
          );
        },
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const existing =
        await prisma.warehouse.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
        });

      if (!existing) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Warehouse not found",
            },
          ],
        });
      }

      await prisma.warehouse.delete({
        where: { id },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "DELETE",
        entityType: "Warehouse",
        entityId: existing.id,
        previousState: existing,
      });

      return {
        data: {
          id: existing.id,
          deleted: true,
        },
      };
    },
  );

}
