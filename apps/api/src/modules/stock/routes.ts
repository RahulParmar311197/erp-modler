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

export async function stockRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  // =========================================================
  // STOCK BALANCES
  // =========================================================

  app.get(
    "/api/stock-balances",
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
            "organization.view",
          ),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const balances =
        await prisma.stockBalance.findMany({
          where: {
            tenantId: claims.tenantId,
          },
          orderBy: {
            createdAt: "asc",
          },
          include: {
            item: true,
            warehouse: true,
            bin: true,
          },
        });

      return {
        data: balances,
      };
    },
  );

  // =========================================================
  // OPENING STOCK
  // =========================================================

  app.post(
    "/api/stock/opening",
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
            "organization.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        itemId?: string;
        warehouseId?: string;
        binId?: string;
        quantity?: number;
        notes?: string;
      };

      if (
        !body.itemId ||
        !body.warehouseId ||
        body.quantity === undefined
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "itemId, warehouseId and quantity are required",
            },
          ],
        });
      }

      if (body.quantity <= 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Opening quantity must be greater than zero",
            },
          ],
        });
      }

      const item = await prisma.item.findFirst({
        where: {
          id: body.itemId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!item) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Item does not exist or is inactive",
            },
          ],
        });
      }

      const warehouse =
        await prisma.warehouse.findFirst({
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
              message:
                "Warehouse does not exist or is inactive",
            },
          ],
        });
      }

      if (body.binId) {
        const bin =
          await prisma.warehouseBin.findFirst({
            where: {
              id: body.binId,
              tenantId: claims.tenantId,
              zone: {
                warehouseId: body.warehouseId,
              },
              active: true,
            },
          });

        if (!bin) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Bin does not exist, is inactive, or belongs to another warehouse",
              },
            ],
          });
        }
      }

      const existing =
        await prisma.stockBalance.findFirst({
          where: {
            tenantId: claims.tenantId,
            itemId: body.itemId,
            warehouseId: body.warehouseId,
            binId: body.binId ?? null,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message:
                "Stock balance already exists for this item and location",
            },
          ],
        });
      }

      const result =
        await prisma.$transaction(async (tx) => {
          const balance =
            await tx.stockBalance.create({
              data: {
                tenantId: claims.tenantId,
                itemId: body.itemId!,
                warehouseId: body.warehouseId!,
                binId: body.binId,
                quantity: body.quantity!,
              },
              include: {
                item: true,
                warehouse: true,
                bin: true,
              },
            });

          const movement =
            await tx.stockMovement.create({
              data: {
                tenantId: claims.tenantId,
                itemId: body.itemId!,
                warehouseId: body.warehouseId!,
                binId: body.binId,
                movementType: "OPENING",
                quantity: body.quantity!,
                referenceType: "OPENING_STOCK",
                referenceId: balance.id,
                notes: body.notes,
              },
            });

          return {
            balance,
            movement,
          };
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "StockBalance",
        entityId: result.balance.id,
        newState: result.balance,
      });

      return reply.code(201).send({
        data: result,
      });
    },
  );

  // =========================================================
  // STOCK ADJUSTMENT
  // =========================================================

  app.post(
    "/api/stock/adjustment",
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
            "organization.update",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        itemId?: string;
        warehouseId?: string;
        binId?: string;
        quantity?: number;
        notes?: string;
      };

      if (
        !body.itemId ||
        !body.warehouseId ||
        body.quantity === undefined
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "itemId, warehouseId and quantity are required",
            },
          ],
        });
      }

      if (body.quantity === 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Adjustment quantity cannot be zero",
            },
          ],
        });
      }

      const balance =
        await prisma.stockBalance.findFirst({
          where: {
            tenantId: claims.tenantId,
            itemId: body.itemId,
            warehouseId: body.warehouseId,
            binId: body.binId ?? null,
          },
        });

      if (!balance) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message:
                "Stock balance does not exist",
            },
          ],
        });
      }

      const newQuantity =
        Number(balance.quantity) + body.quantity;

      if (newQuantity < 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Stock quantity cannot become negative",
            },
          ],
        });
      }

      const result =
        await prisma.$transaction(async (tx) => {
          const updated =
            await tx.stockBalance.update({
              where: {
                id: balance.id,
              },
              data: {
                quantity: newQuantity,
              },
              include: {
                item: true,
                warehouse: true,
                bin: true,
              },
            });

          const movement =
            await tx.stockMovement.create({
              data: {
                tenantId: claims.tenantId,
                itemId: body.itemId!,
                warehouseId: body.warehouseId!,
                binId: body.binId,
                movementType: "ADJUSTMENT",
                quantity: body.quantity!,
                referenceType: "STOCK_ADJUSTMENT",
                referenceId: balance.id,
                notes: body.notes,
              },
            });

          return {
            balance: updated,
            movement,
          };
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "StockBalance",
        entityId: balance.id,
        previousState: balance,
        newState: result.balance,
      });

      return {
        data: result,
      };
    },
  );

  // =========================================================
  // STOCK MOVEMENTS
  // =========================================================

  app.get(
    "/api/stock/movements",
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
            "organization.view",
          ),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const movements =
        await prisma.stockMovement.findMany({
          where: {
            tenantId: claims.tenantId,
          },
          orderBy: {
            createdAt: "desc",
          },
          include: {
            item: true,
            warehouse: true,
            bin: true,
          },
        });

      return {
        data: movements,
      };
    },
  );

  // =========================================================
  // STOCK TRANSFER
  // =========================================================

  app.post(
    "/api/stock/transfer",
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
            "organization.update",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        itemId?: string;
        sourceWarehouseId?: string;
        sourceBinId?: string;
        destinationWarehouseId?: string;
        destinationBinId?: string;
        quantity?: number;
        notes?: string;
      };

      if (
        !body.itemId ||
        !body.sourceWarehouseId ||
        !body.destinationWarehouseId ||
        body.quantity === undefined
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "itemId, sourceWarehouseId, destinationWarehouseId and quantity are required",
            },
          ],
        });
      }

      if (body.quantity <= 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Transfer quantity must be greater than zero",
            },
          ],
        });
      }

      if (
        body.sourceWarehouseId ===
          body.destinationWarehouseId &&
        (body.sourceBinId ?? null) ===
          (body.destinationBinId ?? null)
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Source and destination cannot be the same location",
            },
          ],
        });
      }

      const item = await prisma.item.findFirst({
        where: {
          id: body.itemId,
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
                "Item does not exist or is inactive",
            },
          ],
        });
      }

      const sourceWarehouse =
        await prisma.warehouse.findFirst({
          where: {
            id: body.sourceWarehouseId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!sourceWarehouse) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Source warehouse does not exist or is inactive",
            },
          ],
        });
      }

      const destinationWarehouse =
        await prisma.warehouse.findFirst({
          where: {
            id: body.destinationWarehouseId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!destinationWarehouse) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Destination warehouse does not exist or is inactive",
            },
          ],
        });
      }

      if (body.sourceBinId) {
        const sourceBin =
          await prisma.warehouseBin.findFirst({
            where: {
              id: body.sourceBinId,
              tenantId: claims.tenantId,
              active: true,
              zone: {
                warehouseId: body.sourceWarehouseId,
              },
            },
          });

        if (!sourceBin) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Source bin does not exist or does not belong to source warehouse",
              },
            ],
          });
        }
      }

      if (body.destinationBinId) {
        const destinationBin =
          await prisma.warehouseBin.findFirst({
            where: {
              id: body.destinationBinId,
              tenantId: claims.tenantId,
              active: true,
              zone: {
                warehouseId:
                  body.destinationWarehouseId,
              },
            },
          });

        if (!destinationBin) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Destination bin does not exist or does not belong to destination warehouse",
              },
            ],
          });
        }
      }

      const sourceBalance =
        await prisma.stockBalance.findFirst({
          where: {
            tenantId: claims.tenantId,
            itemId: body.itemId,
            warehouseId: body.sourceWarehouseId,
            binId: body.sourceBinId ?? null,
          },
        });

      if (!sourceBalance) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message:
                "Source stock balance does not exist",
            },
          ],
        });
      }

      const sourceQuantity =
        Number(sourceBalance.quantity);

      if (sourceQuantity < body.quantity) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                `Insufficient stock. Available: ${sourceQuantity}`,
            },
          ],
        });
      }

      const result =
        await prisma.$transaction(async (tx) => {
          const updatedSource =
            await tx.stockBalance.update({
              where: {
                id: sourceBalance.id,
              },
              data: {
                quantity:
                  sourceQuantity - body.quantity!,
              },
              include: {
                item: true,
                warehouse: true,
                bin: true,
              },
            });

          const destinationBalance =
            await tx.stockBalance.findFirst({
              where: {
                tenantId: claims.tenantId,
                itemId: body.itemId,
                warehouseId:
                  body.destinationWarehouseId,
                binId:
                  body.destinationBinId ?? null,
              },
            });

          let updatedDestination;

          if (destinationBalance) {
            updatedDestination =
              await tx.stockBalance.update({
                where: {
                  id: destinationBalance.id,
                },
                data: {
                  quantity:
                    Number(destinationBalance.quantity) +
                    body.quantity!,
                },
                include: {
                  item: true,
                  warehouse: true,
                  bin: true,
                },
              });
          } else {
            updatedDestination =
              await tx.stockBalance.create({
                data: {
                  tenantId: claims.tenantId,
                  itemId: body.itemId!,
                  warehouseId:
                    body.destinationWarehouseId!,
                  binId: body.destinationBinId,
                  quantity: body.quantity!,
                },
                include: {
                  item: true,
                  warehouse: true,
                  bin: true,
                },
              });
          }

          const sourceMovement =
            await tx.stockMovement.create({
              data: {
                tenantId: claims.tenantId,
                itemId: body.itemId!,
                warehouseId:
                  body.sourceWarehouseId!,
                binId: body.sourceBinId,
                movementType: "TRANSFER_OUT",
                quantity: body.quantity!,
                referenceType: "STOCK_TRANSFER",
                referenceId:
                  updatedDestination.id,
                notes: body.notes,
              },
            });

          const destinationMovement =
            await tx.stockMovement.create({
              data: {
                tenantId: claims.tenantId,
                itemId: body.itemId!,
                warehouseId:
                  body.destinationWarehouseId!,
                binId: body.destinationBinId,
                movementType: "TRANSFER_IN",
                quantity: body.quantity!,
                referenceType: "STOCK_TRANSFER",
                referenceId:
                  updatedSource.id,
                notes: body.notes,
              },
            });

          return {
            source: updatedSource,
            destination: updatedDestination,
            movements: [
              sourceMovement,
              destinationMovement,
            ],
          };
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "TRANSFER",
        entityType: "StockBalance",
        entityId: result.source.id,
        previousState: sourceBalance,
        newState: result,
      });

      return {
        data: result,
      };
    },
  );


  app.get(
    "/api/stock-movements",
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

      const movements = await prisma.stockMovement.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          item: true,
          warehouse: true,
          bin: true,
        },
      });

      return {
        data: movements,
      };
    },
  );
}
