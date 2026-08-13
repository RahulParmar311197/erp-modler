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
import { prisma } from "../../lib/prisma";

export async function supplierRoutes(
  app: FastifyInstance,
) {
  // ---------------------------------------------------------
  // GET SUPPLIERS
  // ---------------------------------------------------------

  app.get(
    "/api/suppliers",
    {
      preHandler: [
        authenticate,
        async (
          request: FastifyRequest,
          reply: FastifyReply,
        ) =>
          requirePermission(
            request,
            reply,
            "user.view",
          ),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const suppliers = await prisma.supplier.findMany({
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

      return {
        data: suppliers,
      };
    },
  );

  // ---------------------------------------------------------
  // CREATE SUPPLIER
  // ---------------------------------------------------------

  app.post(
    "/api/suppliers",
    {
      preHandler: [
        authenticate,
        async (
          request: FastifyRequest,
          reply: FastifyReply,
        ) =>
          requirePermission(
            request,
            reply,
            "user.create",
          ),
      ],
    },
    async (
      request,
      reply,
    ) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        code?: string;
        name?: string;
        organizationId?: string;
        email?: string;
        phone?: string;
        taxNumber?: string;
        paymentTerms?: string;
        currency?: string;
      };

      const code = body.code?.trim();
      const name = body.name?.trim();

      if (!code || !name) {
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
        await prisma.supplier.findFirst({
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
              message:
                "Supplier code already exists",
            },
          ],
        });
      }

      let supplier;

      try {
        supplier =
          await prisma.supplier.create({
            data: {
              tenantId: claims.tenantId,
              organizationId:
                body.organizationId ?? null,
              code,
              name,
              email: body.email?.trim() || null,
              phone: body.phone?.trim() || null,
              taxNumber:
                body.taxNumber?.trim() || null,
              paymentTerms:
                body.paymentTerms?.trim() || null,
              currency:
                body.currency?.trim() || "INR",
            },
            include: {
              organization: true,
            },
          });
      } catch (error) {
        /*
         * The pre-check above is not sufficient for concurrent requests.
         *
         * The database unique constraint on (tenantId, code)
         * is the final authority. If another request creates the supplier
         * between our pre-check and create(), Prisma raises P2002.
         */
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        ) {
          return reply.code(409).send({
            errors: [
              {
                code: "CONFLICT",
                message:
                  "Supplier code already exists",
              },
            ],
          });
        }

        throw error;
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "Supplier",
        entityId: supplier.id,
        newState: supplier,
      });

      return reply.code(201).send({
        data: supplier,
      });
    },
  );

// ---------------------------------------------------------
// APPROVE PURCHASE ORDER
// ---------------------------------------------------------

app.post(
  "/api/purchase-orders/:id/approve",
  {
    preHandler: [
      authenticate,
      async (
        request: FastifyRequest,
        reply: FastifyReply,
      ) =>
        requirePermission(
          request,
          reply,
          "role.manage",
        ),
    ],
  },
  async (
    request,
    reply,
  ) => {
    const claims = request.user as AuthClaims;

    const { id } = request.params as {
      id: string;
    };

    const purchaseOrder =
      await prisma.purchaseOrder.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          supplier: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

    if (!purchaseOrder) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "Purchase order not found",
          },
        ],
      });
    }

    if (purchaseOrder.status !== "SUBMITTED") {
      return reply.code(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message:
              `Purchase order cannot be approved from status ${purchaseOrder.status}`,
          },
        ],
      });
    }

    const approved =
      await prisma.purchaseOrder.update({
        where: {
          id: purchaseOrder.id,
        },
        data: {
          status: "APPROVED",
        },
        include: {
          supplier: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "APPROVE",
      entityType: "PurchaseOrder",
      entityId: approved.id,
      previousState: {
        status: purchaseOrder.status,
      },
      newState: {
        status: approved.status,
      },
    });

    return {
      data: approved,
    };
  },
);

}
