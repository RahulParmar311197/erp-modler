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
}
