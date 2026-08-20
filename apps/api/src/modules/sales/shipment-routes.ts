import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requirePermission, AuthClaims } from "../../auth/authorization";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import { postJournalEntry } from "../accounting/journal-service";

export async function shipmentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post(
    "/api/sales/shipments",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.create")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as {
        salesOrderId?: string;
        shipmentDate?: string;
        warehouseId?: string;
        lines?: { salesOrderLineId?: string; itemId?: string; warehouseId?: string; binId?: string; quantity?: number }[];
      };

      if (!body.salesOrderId) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "salesOrderId is required" }] });

      const so = await prisma.salesOrder.findFirst({ where: { id: body.salesOrderId, tenantId: claims.tenantId }, include: { lines: true } });
      if (!so) return reply.code(404).send({ errors: [{ code: "NOT_FOUND", message: "Sales order not found" }] });

      const lines = body.lines ?? [];
      if (lines.length < 1) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "At least one shipment line is required" }] });

      const shipment = await prisma.$transaction(async (tx) => {
        const shipmentNumber = `SH-${Date.now()}`;
        const created = await tx.shipment.create({ data: { tenantId: claims.tenantId, salesOrderId: so.id, shipmentNumber, shipmentDate: body.shipmentDate ? new Date(`${body.shipmentDate}T00:00:00.000Z`) : new Date(), warehouseId: body.warehouseId ?? lines[0].warehouseId ?? '' } });

        let totalCost = 0;
        for (const l of lines) {
          const sol = l.salesOrderLineId ? await tx.salesOrderLine.findUnique({ where: { id: l.salesOrderLineId } }) : undefined;
          const itemId = sol ? sol.itemId : l.itemId;
          const qty = Number(l.quantity ?? (sol ? sol.quantity : 0));

          await tx.shipmentLine.create({ data: { tenantId: claims.tenantId, shipmentId: created.id, salesOrderLineId: sol ? sol.id : undefined, itemId: itemId!, warehouseId: l.warehouseId ?? created.warehouseId, binId: l.binId ?? null, quantity: qty } });

          // Stock movement OUT
          await tx.stockMovement.create({ data: { tenantId: claims.tenantId, itemId: itemId!, warehouseId: l.warehouseId ?? created.warehouseId, binId: l.binId ?? null, movementType: "OUT", quantity: qty, referenceType: "Shipment", referenceId: created.id } });

          // Update stock balance
          const sb = await tx.stockBalance.findFirst({ where: { tenantId: claims.tenantId, itemId: itemId!, warehouseId: l.warehouseId ?? created.warehouseId } });
          if (sb) {
            await tx.stockBalance.update({ where: { id: sb.id }, data: { quantity: { decrement: qty } as any } as any });
          } else {
            // negative balance allowed
            await tx.stockBalance.create({ data: { tenantId: claims.tenantId, itemId: itemId!, warehouseId: l.warehouseId ?? created.warehouseId, quantity: -qty } });
          }

          // accumulate cost using sol.unitPrice if present
          if (sol) totalCost += Number(sol.unitPrice) * qty;
        }

        // Create JE to move Inventory -> COGS if we have totalCost
        if (totalCost > 0) {
          await postJournalEntry(tx as any, {
            tenantId: claims.tenantId,
            organizationId: so.organizationId,
            entryNumber: `JE-SH-${Date.now()}`,
            entryDate: created.shipmentDate,
            description: `Shipment ${created.shipmentNumber}`,
            sourceType: "Shipment",
            sourceId: created.id,
            lines: [
              { accountCode: "5000", description: "COGS", debit: totalCost, credit: 0 },
              { accountCode: "1200", description: "Inventory", debit: 0, credit: totalCost },
            ],
          });
        }

        return tx.shipment.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
      });

      return reply.code(201).send({ data: shipment });
    },
  );
}
