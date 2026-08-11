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

export async function purchaseOrderRoutes(
  app: FastifyInstance,
) {
  // =========================================================
  // LIST PURCHASE ORDERS
  // =========================================================

  app.get(
    "/api/purchase-orders",
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

      const orders =
        await prisma.purchaseOrder.findMany({
          where: {
            tenantId: claims.tenantId,
          },
          orderBy: {
            createdAt: "desc",
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

      return {
        data: orders,
      };
    },
  );

  // =========================================================
  // GET PURCHASE ORDER
  // =========================================================

  app.get(
    "/api/purchase-orders/:id",
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
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const order =
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

      if (!order) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Purchase order not found",
            },
          ],
        });
      }

      return {
        data: order,
      };
    },
  );

  // =========================================================
  // CREATE PURCHASE ORDER
  // =========================================================

  app.post(
    "/api/purchase-orders",
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
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        poNumber?: string;
        organizationId?: string;
        supplierId?: string;
        expectedDate?: string;
        currency?: string;
        notes?: string;
        lines?: Array<{
          itemId?: string;
          uomId?: string;
          quantity?: number;
          unitPrice?: number;
        }>;
      };

      const poNumber = body.poNumber?.trim();

      if (
        !poNumber ||
        !body.organizationId ||
        !body.supplierId ||
        !Array.isArray(body.lines) ||
        body.lines.length === 0
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "poNumber, organizationId, supplierId and at least one line are required",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // ORGANIZATION
      // -------------------------------------------------------

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

      // -------------------------------------------------------
      // SUPPLIER
      // -------------------------------------------------------

      const supplier =
        await prisma.supplier.findFirst({
          where: {
            id: body.supplierId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!supplier) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Supplier does not exist or is inactive",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // DUPLICATE PO NUMBER
      // -------------------------------------------------------

      const existing =
        await prisma.purchaseOrder.findFirst({
          where: {
            tenantId: claims.tenantId,
            poNumber,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message:
                "Purchase order number already exists",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // VALIDATE LINES
      // -------------------------------------------------------

      const lineData = [];

      for (const line of body.lines) {
        if (
          !line.itemId ||
          !line.uomId ||
          line.quantity === undefined ||
          line.unitPrice === undefined
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Each line requires itemId, uomId, quantity and unitPrice",
              },
            ],
          });
        }

        if (line.quantity <= 0) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Line quantity must be greater than zero",
              },
            ],
          });
        }

        if (line.unitPrice < 0) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Unit price cannot be negative",
              },
            ],
          });
        }

        const item =
          await prisma.item.findFirst({
            where: {
              id: line.itemId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!item) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  `Item ${line.itemId} does not exist or is inactive`,
              },
            ],
          });
        }

        const uom =
          await prisma.unitOfMeasure.findFirst({
            where: {
              id: line.uomId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!uom) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  `UOM ${line.uomId} does not exist or is inactive`,
              },
            ],
          });
        }

        lineData.push({
          itemId: line.itemId,
          uomId: line.uomId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        });
      }

      // -------------------------------------------------------
      // CREATE PO
      // -------------------------------------------------------

      const order =
        await prisma.purchaseOrder.create({
          data: {
            tenantId: claims.tenantId,
            organizationId:
              body.organizationId,
            supplierId: body.supplierId,
            poNumber,
            status: "DRAFT",
            expectedDate: body.expectedDate
              ? new Date(body.expectedDate)
              : null,
            currency:
              body.currency?.trim() || "INR",
            notes:
              body.notes?.trim() || null,
            lines: {
              create: lineData,
            },
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
        action: "CREATE",
        entityType: "PurchaseOrder",
        entityId: order.id,
        newState: order,
      });

      return reply.code(201).send({
        data: order,
      });
    },
  );

  // =========================================================
  // SUBMIT PURCHASE ORDER
  // =========================================================

  app.post(
    "/api/purchase-orders/:id/submit",
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
            "user.update",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const order =
        await prisma.purchaseOrder.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
        });

      if (!order) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Purchase order not found",
            },
          ],
        });
      }

      if (order.status !== "DRAFT") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Only draft purchase orders can be submitted",
            },
          ],
        });
      }

      const updated =
        await prisma.purchaseOrder.update({
          where: {
            id: order.id,
          },
          data: {
            status: "SUBMITTED",
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
        action: "SUBMIT",
        entityType: "PurchaseOrder",
        entityId: order.id,
        previousState: order,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );
}
