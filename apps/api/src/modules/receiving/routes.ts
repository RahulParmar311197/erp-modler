import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requirePermission, AuthClaims } from "../../auth/authorization";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import { postJournalEntry } from "../accounting/journal-service";

export async function goodsReceiptRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post(
    "/api/receiving/goods-receipts",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.create")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as {
        purchaseOrderId?: string;
        receiptDate?: string;
        lines?: { purchaseOrderLineId?: string; itemId?: string; warehouseId?: string; binId?: string; quantity?: number }[];
      };

      if (!body.purchaseOrderId) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "purchaseOrderId is required" }] });
      }

      const po = await prisma.purchaseOrder.findFirst({ where: { id: body.purchaseOrderId, tenantId: claims.tenantId }, include: { lines: true } });
      if (!po) return reply.code(404).send({ errors: [{ code: "NOT_FOUND", message: "Purchase order not found" }] });

      const lines = body.lines ?? [];
      if (lines.length < 1) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "At least one receipt line is required" }] });

      // Perform GR inside transaction: create GoodsReceipt, GoodsReceiptLines, StockMovements, update StockBalance, and create journal entry
      const gr = await prisma.$transaction(async (tx) => {
        const receiptNumber = `GR-${Date.now()}`;
        const created = await tx.goodsReceipt.create({ data: { tenantId: claims.tenantId, purchaseOrderId: po.id, receiptNumber, receiptDate: body.receiptDate ? new Date(`${body.receiptDate}T00:00:00.000Z`) : new Date(), status: "POSTED" } });

        // Create lines and stock movements
        let totalAmount = 0;

        for (const l of lines) {
          const pol = l.purchaseOrderLineId ? await tx.purchaseOrderLine.findUnique({ where: { id: l.purchaseOrderLineId } }) : undefined;
          const itemId = pol ? pol.itemId : l.itemId;
          const qty = Number(l.quantity ?? (pol ? pol.quantity : 0));

          await tx.goodsReceiptLine.create({ data: { tenantId: claims.tenantId, goodsReceiptId: created.id, purchaseOrderLineId: pol ? pol.id : undefined, itemId: itemId!, warehouseId: l.warehouseId!, binId: l.binId ?? null, quantity: qty } });

          // Stock movement
          await tx.stockMovement.create({ data: { tenantId: claims.tenantId, itemId: itemId!, warehouseId: l.warehouseId!, binId: l.binId ?? null, movementType: "IN", quantity: qty, referenceType: "GoodsReceipt", referenceId: created.id } });

          // Update stock balance (upsert)
          const sb = await tx.stockBalance.findFirst({ where: { tenantId: claims.tenantId, itemId: itemId!, warehouseId: l.warehouseId! } });
          if (sb) {
            await tx.stockBalance.update({ where: { id: sb.id }, data: { quantity: { increment: qty } as any } as any });
          } else {
            await tx.stockBalance.create({ data: { tenantId: claims.tenantId, itemId: itemId!, warehouseId: l.warehouseId!, quantity: qty } });
          }

          // accumulate amount if PO line present
          if (pol) {
            totalAmount += Number(pol.unitPrice) * qty;
          }
        }

        // Create a journal entry: Debit Inventory (accountCode '1200'), Credit Accounts Payable ('2000')
        if (totalAmount > 0) {
          await postJournalEntry(tx as any, {
            tenantId: claims.tenantId,
            organizationId: po.organizationId,
            entryNumber: `JE-GR-${Date.now()}`,
            entryDate: created.receiptDate,
            description: `Goods Receipt ${created.receiptNumber}`,
            sourceType: "GoodsReceipt",
            sourceId: created.id,
            lines: [
              { accountCode: "1200", description: "Inventory", debit: totalAmount, credit: 0 },
              { accountCode: "2000", description: "Accounts Payable", debit: 0, credit: totalAmount },
            ],
          });
        }

        return tx.goodsReceipt.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
      });

      return reply.code(201).send({ data: gr });
    },
  );
}
