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

export async function locationRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  app.get(
    "/api/locations",
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

      const locations = await prisma.location.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
        include: {
          organization: true,
          warehouses: true,
        },
      });

      return {
        data: locations,
      };
    },
  );

  app.post(
    "/api/locations",
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
        organizationId?: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country?: string;
        timezone?: string;
      };

      if (!body.code || !body.name) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "code and name are required",
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
            },
          });

        if (!organization) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Organization does not belong to tenant",
              },
            ],
          });
        }
      }

      const existing =
        await prisma.location.findFirst({
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
              message: "Location code already exists",
            },
          ],
        });
      }

      const location =
        await prisma.location.create({
          data: {
            tenantId: claims.tenantId,
            organizationId: body.organizationId,
            code: body.code,
            name: body.name,
            addressLine1: body.addressLine1,
            addressLine2: body.addressLine2,
            city: body.city,
            state: body.state,
            postalCode: body.postalCode,
            country: body.country ?? "IN",
            timezone: body.timezone,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "Location",
        entityId: location.id,
        newState: location,
      });

      return reply.code(201).send({
        data: location,
      });
    },
  );
}
