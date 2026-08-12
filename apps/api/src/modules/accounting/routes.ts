import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  authenticate,
  requirePermission,
  AuthClaims,
} from "../../auth/authorization";

import { writeAuditEvent } from "../../audit/audit";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

export async function accountingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  app.get(
    "/api/gl/accounts",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
        include: {
          organization: true,
        },
      });

      return { data: accounts };
    },
  );

  app.post(
    "/api/gl/accounts",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        code?: string;
        name?: string;
        type?: string;
        organizationId?: string;
      };

      const code = body.code?.trim();
      const name = body.name?.trim();
      const type = body.type?.trim();

      const validTypes = [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
      ];

      if (!code || !name || !type) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "code, name and type are required",
            },
          ],
        });
      }

      if (!validTypes.includes(type)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid GL account type",
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
                code: "VALIDATION_ERROR",
                message: "Organization does not exist or is inactive",
              },
            ],
          });
        }
      }

      const existing = await prisma.glAccount.findFirst({
        where: {
          tenantId: claims.tenantId,
          code,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "GL account code already exists",
            },
          ],
        });
      }

      const account = await prisma.glAccount.create({
        data: {
          tenantId: claims.tenantId,
          organizationId: body.organizationId ?? null,
          code,
          name,
          type: type as
            | "ASSET"
            | "LIABILITY"
            | "EQUITY"
            | "REVENUE"
            | "EXPENSE",
        },
        include: {
          organization: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "GlAccount",
        entityId: account.id,
        newState: account,
      });

      return reply.code(201).send({
        data: account,
      });
    },
  );
}
