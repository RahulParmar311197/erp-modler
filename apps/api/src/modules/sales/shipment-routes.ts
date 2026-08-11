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

export async function shipmentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // =========================================================
  // LIST SHIPMENTS
  // =========================================================

  app.get(
    "/api/shipments",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const shipments = await prisma.shipment.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          salesOrder: {
            include: {
              customer: true,
              organization: true,
            },
          },
          warehouse: true,
          lines: {
            include: {
              item: true,
              bin: true,
              salesOrderLine: true,
            },
          },
        },
      });

      return {
        data: shipments,
      };
    },
  );

  // =========================================================
  // GET SINGLE SHIPMENT
  // =========================================================

  app.get(
    "/api/shipments/:id",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const shipment = await prisma.shipment.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          salesOrder: {
            include: {
              customer: true,
              organization: true,
              lines: {
                include: {
                  item: true,
                  uom: true,
                },
              },
            },
          },
          warehouse: true,
          lines: {
            include: {
              item: true,
              bin: true,
              salesOrderLine: true,
            },
          },
        },
      });

      if (!shipment) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Shipment not found",
            },
          ],
        });
      }

      return {
        data: shipment,
      };
    },
  );

  // =========================================================
  // SHIP SALES ORDER
  // =========================================================

  app.post(
    "/api/sales-orders/:id/ship",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const body = request.body as {
        shipmentNumber?: string;
        warehouseId?: string;
        binId?: string;
        notes?: string;
        lines?: Array<{
          salesOrderLineId?: string;
          quantity?: number;
        }>;
      };

      const shipmentNumber = body.shipmentNumber?.trim();

      if (!shipmentNumber || !body.warehouseId || !body.binId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "shipmentNumber, warehouseId and binId are required",
            },
          ],
        });
      }

      if (!body.lines?.length) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "At least one shipment line is required",
            },
          ],
        });
      }

      const order = await prisma.salesOrder.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          customer: true,
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
              message: "Sales order not found",
            },
          ],
        });
      }

      if (
        order.status !== "APPROVED" &&
        order.status !== "PARTIALLY_SHIPPED"
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Only APPROVED or PARTIALLY_SHIPPED sales orders can be shipped",
            },
          ],
        });
      }

      const warehouse = await prisma.warehouse.findFirst({
        where: {
          id: body.warehouseId,
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

      const bin = await prisma.warehouseBin.findFirst({
        where: {
          id: body.binId,
          tenantId: claims.tenantId,
          active: true,
          zone: {
            warehouseId: body.warehouseId,
          },
        },
      });

      if (!bin) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Bin does not exist or does not belong to the warehouse",
            },
          ],
        });
      }

      const existing = await prisma.shipment.findFirst({
        where: {
          tenantId: claims.tenantId,
          shipmentNumber,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Shipment number already exists",
            },
          ],
        });
      }

      // Validate duplicate line IDs before opening transaction.
      const requestedLineIds = body.lines
        .map((line) => line.salesOrderLineId)
        .filter(Boolean);

      if (
        new Set(requestedLineIds).size !== requestedLineIds.length
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "A sales order line cannot appear more than once in a shipment",
            },
          ],
        });
      }

      for (const shipmentLine of body.lines) {
        if (
          !shipmentLine.salesOrderLineId ||
          shipmentLine.quantity === undefined ||
          shipmentLine.quantity <= 0
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Each shipment line requires salesOrderLineId and positive quantity",
              },
            ],
          });
        }

        const orderLine = order.lines.find(
          (line) => line.id === shipmentLine.salesOrderLineId,
        );

        if (!orderLine) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Shipment line does not belong to this sales order",
              },
            ],
          });
        }

        const orderedQty = Number(orderLine.quantity);
        const alreadyShipped = Number(orderLine.shippedQty);
        const remainingQty = orderedQty - alreadyShipped;

        if (shipmentLine.quantity > remainingQty) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  `Cannot ship ${shipmentLine.quantity} of ${orderLine.item.sku}. Remaining quantity: ${remainingQty}`,
              },
            ],
          });
        }
      }

      let result;

      try {
        result = await prisma.$transaction(async (tx) => {
          const shipment = await tx.shipment.create({
            data: {
              tenantId: claims.tenantId,
              salesOrderId: order.id,
              warehouseId: body.warehouseId!,
              shipmentNumber,
              notes: body.notes?.trim() || null,
            },
          });

          for (const requestedLine of body.lines!) {
            const orderLine = order.lines.find(
              (line) =>
                line.id === requestedLine.salesOrderLineId,
            )!;

            const shipmentQty = requestedLine.quantity!;

        /*
         * Atomically reserve the requested shipment quantity.
         *
         * PostgreSQL serializes this UPDATE on the SalesOrderLine row.
         * The WHERE clause prevents shippedQty from exceeding quantity.
         */
          const reservedRows = await tx.$queryRaw<
            Array<{
              id: string;
              quantity: unknown;
              shippedQty: unknown;
              itemId: string;
            }>
          >`
            UPDATE "SalesOrderLine"
            SET "shippedQty" = "shippedQty" + ${shipmentQty}
            WHERE "id" = ${orderLine.id}
              AND "shippedQty" + ${shipmentQty} <= "quantity"
            RETURNING
              "id",
              "quantity",
              "shippedQty",
              "itemId"
          `;

        const lockedLine = reservedRows[0];

        if (!lockedLine) {
          const currentLine = await tx.salesOrderLine.findUnique({
            where: {
              id: orderLine.id,
            },
          });

          const currentShippedQty = currentLine
            ? Number(currentLine.shippedQty)
            : 0;

          const currentOrderedQty = currentLine
            ? Number(currentLine.quantity)
            : 0;

          const remainingQty =
            currentOrderedQty - currentShippedQty;

          throw new Error(
            `Cannot ship ${shipmentQty} of ${orderLine.item.sku}. Remaining quantity: ${remainingQty}`,
          );
        }

        const alreadyShipped =
          Number(lockedLine.shippedQty) - shipmentQty;

        const balance =
              await tx.stockBalance.findFirst({
                where: {
                  tenantId: claims.tenantId,
                  itemId: orderLine.itemId,
                  warehouseId: body.warehouseId!,
                  binId: body.binId!,
                },
              });

            if (!balance) {
              throw new Error(
                `No stock balance for item ${orderLine.item.sku}`,
              );
            }

            const available = Number(balance.quantity);

            if (available < shipmentQty) {
              throw new Error(
                `Insufficient stock for ${orderLine.item.sku}. Available: ${available}, required: ${shipmentQty}`,
              );
            }

            await tx.stockBalance.update({
              where: {
                id: balance.id,
              },
              data: {
                quantity: available - shipmentQty,
              },
            });

            await tx.shipmentLine.create({
              data: {
                tenantId: claims.tenantId,
                shipmentId: shipment.id,
                salesOrderLineId: orderLine.id,
                itemId: orderLine.itemId,
                warehouseId: body.warehouseId!,
                binId: body.binId!,
                quantity: shipmentQty,
              },
            });


            await tx.stockMovement.create({
              data: {
                tenantId: claims.tenantId,
                itemId: orderLine.itemId,
                warehouseId: body.warehouseId!,
                binId: body.binId!,
                movementType: "SALES_SHIPMENT",
                quantity: shipmentQty,
                referenceType: "SHIPMENT",
                referenceId: shipment.id,
                notes:
                  body.notes?.trim() ||
                  `Shipment ${shipmentNumber} against ${order.orderNumber}`,
              },
            });
          }

          const finalLines =
            await tx.salesOrderLine.findMany({
              where: {
                salesOrderId: order.id,
              },
            });

          const allShipped = finalLines.every(
            (line) =>
              Number(line.shippedQty) >=
              Number(line.quantity),
          );

          const anyShipped = finalLines.some(
            (line) => Number(line.shippedQty) > 0,
          );

          const newStatus = allShipped
            ? "SHIPPED"
            : anyShipped
              ? "PARTIALLY_SHIPPED"
              : "APPROVED";

          const updatedOrder =
            await tx.salesOrder.update({
              where: {
                id: order.id,
              },
              data: {
                status: newStatus,
              },
            });

          return {
            shipment,
            updatedOrder,
          };
        });
      } catch (error) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "Shipment could not be created",
            },
          ],
        });
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "SHIP",
        entityType: "SalesOrder",
        entityId: order.id,
        previousState: order,
        newState: result,
      });

      const shipment = await prisma.shipment.findUnique({
        where: {
          id: result.shipment.id,
        },
        include: {
          salesOrder: {
            include: {
              customer: true,
              organization: true,
              lines: {
                include: {
                  item: true,
                  uom: true,
                },
              },
            },
          },
          warehouse: true,
          lines: {
            include: {
              item: true,
              bin: true,
              salesOrderLine: true,
            },
          },
        },
      });

      return reply.code(201).send({
        data: shipment,
      });
    },
  );
}
