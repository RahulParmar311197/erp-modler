import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requirePermission, AuthClaims } from "../../auth/authorization";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type POLineInput = {
  itemId?: string;
  uomId?: string;
  quantity?: number;
  unitPrice?: number;
};

export async function purchaseOrderRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post(
    "/api/purchase-orders",
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
        organizationId?: string;
        supplierId?: string;
        orderDate?: string;
        expectedDate?: string;
        currency?: string;
        notes?: string;
        lines?: POLineInput[];
      };

      if (!body.organizationId || !body.supplierId) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "organizationId and supplierId are required" }] });
      }

      const lines = body.lines ?? [];
      if (lines.length < 1) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "At least one order line is required" }] });
      }

      // Basic validation of line fields
      for (const line of lines) {
        if (!line.itemId || !line.uomId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
          return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Each line requires itemId, uomId and positive quantity" }] });
        }
      }

      // Validate organization and supplier
      const [organization, supplier] = await Promise.all([
        prisma.organization.findFirst({ where: { id: body.organizationId, tenantId: claims.tenantId, active: true } }),
        prisma.supplier.findFirst({ where: { id: body.supplierId, tenantId: claims.tenantId, active: true } }),
      ]);

      if (!organization) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Organization not found or inactive" }] });
      }

      if (!supplier) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Supplier not found or inactive" }] });
      }

      // Create PO inside a transaction
      const po = await prisma.$transaction(async (tx) => {
        // Simple PO numbering: tenantId + timestamp. You can replace with proper sequence later.
        const poNumber = `PO-${Date.now()}`;

        const created = await tx.purchaseOrder.create({
          data: {
            tenantId: claims.tenantId,
            organizationId: organization.id,
            supplierId: supplier.id,
            poNumber,
            orderDate: body.orderDate ? new Date(`${body.orderDate}T00:00:00.000Z`) : new Date(),
            expectedDate: body.expectedDate ? new Date(`${body.expectedDate}T00:00:00.000Z`) : null,
            currency: body.currency ?? supplier.currency ?? "INR",
            notes: body.notes ?? null,
          },
        });

        await Promise.all(
          lines.map((line) =>
            tx.purchaseOrderLine.create({
              data: {
                purchaseOrderId: created.id,
                itemId: line.itemId!,
                uomId: line.uomId!,
                quantity: Number(line.quantity),
                unitPrice: Number(line.unitPrice ?? 0),
              },
            }),
          ),
        );

        return tx.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
      });

      return reply.code(201).send({ data: po });
    },
  );

  app.get(
    "/api/purchase-orders/:id",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.view")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const po = await prisma.purchaseOrder.findFirst({
        where: { id, tenantId: claims.tenantId },
        include: { lines: { include: { item: true, uom: true } }, supplier: true, organization: true },
      });

      if (!po) {
        return reply.code(404).send({ errors: [{ code: "NOT_FOUND", message: "Purchase order not found" }] });
      }

      return { data: po };
    },
  );
}
