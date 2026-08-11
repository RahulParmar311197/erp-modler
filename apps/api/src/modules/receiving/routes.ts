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

export async function goodsReceiptRoutes(app: FastifyInstance) {
  app.get(
    "/api/goods-receipts",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const receipts = await prisma.goodsReceipt.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          purchaseOrder: true,
          lines: {
            include: {
              item: true,
              warehouse: true,
              bin: true,
            },
          },
        },
      });

      return { data: receipts };
    },
  );

  app.post(
    "/api/goods-receipts",
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
        purchaseOrderId?: string;
        receiptNumber?: string;
        receiptDate?: string;
        notes?: string;
        lines?: Array<{
          purchaseOrderLineId?: string;
          warehouseId?: string;
          binId?: string;
          quantity?: number;
        }>;
      };

      if (
        !body.purchaseOrderId ||
        !body.receiptNumber ||
        !body.lines?.length
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "purchaseOrderId, receiptNumber and lines are required",
            },
          ],
        });
      }

      const po = await prisma.purchaseOrder.findFirst({
        where: {
          id: body.purchaseOrderId,
          tenantId: claims.tenantId,
        },
        include: {
          lines: true,
        },
      });

      if (!po) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Purchase order does not exist",
            },
          ],
        });
      }

      if (po.status !== "APPROVED" && po.status !== "PARTIALLY_RECEIVED") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Purchase order is not available for receipt",
            },
          ],
        });
      }

      const existing = await prisma.goodsReceipt.findFirst({
        where: {
          tenantId: claims.tenantId,
          receiptNumber: body.receiptNumber!.trim(),
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Receipt number already exists",
            },
          ],
        });
      }

      for (const line of body.lines) {
        if (
          !line.purchaseOrderLineId ||
          !line.warehouseId ||
          !line.quantity ||
          line.quantity <= 0
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Each receipt line requires purchaseOrderLineId, warehouseId and positive quantity",
              },
            ],
          });
        }

        const poLine = po.lines.find(
          (item) => item.id === line.purchaseOrderLineId,
        );

        if (!poLine) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Purchase order line does not exist",
              },
            ],
          });
        }

        const warehouse = await prisma.warehouse.findFirst({
          where: {
            id: line.warehouseId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

        if (!warehouse) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Warehouse does not exist or is inactive",
              },
            ],
          });
        }

        if (line.binId) {
          const bin = await prisma.warehouseBin.findFirst({
            where: {
              id: line.binId,
              tenantId: claims.tenantId,
              active: true,
              zone: {
                warehouseId: line.warehouseId,
              },
            },
          });

          if (!bin) {
            return reply.code(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message:
                    "Bin does not exist or does not belong to warehouse",
                },
              ],
            });
          }
        }
      }

      const receipt = await prisma.$transaction(async (tx) => {
        const created = await tx.goodsReceipt.create({
          data: {
            tenantId: claims.tenantId,
            purchaseOrderId: po.id,
            receiptNumber: body.receiptNumber!.trim(),
            receiptDate: body.receiptDate
              ? new Date(body.receiptDate)
              : new Date(),
            notes: body.notes?.trim() || null,
            lines: {
              create: body.lines!.map((line) => {
                const poLine = po.lines.find(
                  (item) => item.id === line.purchaseOrderLineId,
                )!;

                return {
                  tenantId: claims.tenantId,
                  purchaseOrderLineId: poLine.id,
                  itemId: poLine.itemId,
                  warehouseId: line.warehouseId!,
                  binId: line.binId!,
                  quantity: line.quantity!,
                };
              }),
            },
          },
          include: {
            purchaseOrder: true,
            lines: {
              include: {
                item: true,
                warehouse: true,
                bin: true,
              },
            },
          },
        });

        for (const line of body.lines!) {
          const poLine = po.lines.find(
            (item) => item.id === line.purchaseOrderLineId,
          )!;

          const quantity = line.quantity!;

          await tx.stockBalance.upsert({
            where: {
              tenantId_itemId_warehouseId_binId: {
                tenantId: claims.tenantId,
                itemId: poLine.itemId,
                warehouseId: line.warehouseId!,
                binId: line.binId!,
              },
            },
            create: {
              tenantId: claims.tenantId,
              itemId: poLine.itemId,
              warehouseId: line.warehouseId!,
              binId: line.binId!,
              quantity,
            },
            update: {
              quantity: {
                increment: quantity,
              },
            },
          });

          await tx.stockMovement.create({
            data: {
              tenantId: claims.tenantId,
              itemId: poLine.itemId,
              warehouseId: line.warehouseId!,
              binId: line.binId!,
              movementType: "PURCHASE_RECEIPT",
              quantity,
              referenceType: "GOODS_RECEIPT",
              referenceId: created.id,
              notes: body.notes?.trim() || null,
            },
          });

          await tx.purchaseOrderLine.update({
            where: {
              id: poLine.id,
            },
            data: {
              receivedQty: {
                increment: quantity,
              },
            },
          });
        }

        const updatedLines = await tx.purchaseOrderLine.findMany({
          where: {
            purchaseOrderId: po.id,
          },
        });

        const fullyReceived = updatedLines.every(
          (line) => line.receivedQty.gte(line.quantity),
        );

        const partiallyReceived = updatedLines.some(
          (line) => line.receivedQty.gt(0),
        );

        await tx.purchaseOrder.update({
          where: {
            id: po.id,
          },
          data: {
            status: fullyReceived
              ? "RECEIVED"
              : partiallyReceived
                ? "PARTIALLY_RECEIVED"
                : po.status,
          },
        });

        return created;
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "GoodsReceipt",
        entityId: receipt.id,
        requestId: request.id,
        newState: receipt,
      });

      return reply.code(201).send({
        data: receipt,
      });
    },
  );
}
