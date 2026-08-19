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
            "stock.view",
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
              code: "CONFLICT",
              message:
                "Stock balance already exists for this item and location",
            },
          ],
        });
      }

      let result;

      try {
        result =
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
      } catch (error) {
        /*
         * The pre-check above is not sufficient for concurrent requests.
         *
         * The database unique constraint on
         * (tenantId, itemId, warehouseId, binId)
         * is the final authority. If another request creates the same
         * stock balance between our pre-check and create(), Prisma raises
         * P2002.
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
                  "Stock balance already exists for this item and location",
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
            "stock.update",
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

      const result =
        await prisma.$transaction(async (tx) => {
          /*
           * Lock the exact stock balance row before reading quantity.
           *
           * The previous implementation read quantity outside the
           * transaction, which allowed concurrent adjustments to overwrite
           * each other.
           *
           * The explicit ::text cast is required for PostgreSQL when
           * binId is nullable and the parameter can be NULL.
           */
          const rows = await tx.$queryRaw<
            Array<{
              id: string;
            }>
          >`
            SELECT "id"
            FROM "StockBalance"
            WHERE "tenantId" = ${claims.tenantId}::text
              AND "itemId" = ${body.itemId}::text
              AND "warehouseId" = ${body.warehouseId}::text
              AND (
                "binId" = ${body.binId ?? null}::text
                OR (
                  "binId" IS NULL
                  AND ${body.binId ?? null}::text IS NULL
                )
              )
            FOR UPDATE
          `;

          const lockedRow = rows[0];

          if (!lockedRow) {
            return {
              missing: true as const,
            };
          }

          /*
           * Now that the row is locked, read the current quantity.
           * This read occurs inside the same transaction.
           */
          const balance =
            await tx.stockBalance.findUnique({
              where: {
                id: lockedRow.id,
              },
            });

          if (!balance) {
            return {
              missing: true as const,
            };
          }

          const currentQuantity =
            Number(balance.quantity);

          const newQuantity =
            currentQuantity + body.quantity!;

          if (newQuantity < 0) {
            return {
              insufficient: true as const,
            };
          }

          const updated =
            await tx.stockBalance.update({
              where: {
                id: balance.id,
              },
              data: {
                quantity: newQuantity,
              },});

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
            previousBalance: balance,
          };
        });

      if ("missing" in result && result.missing) {
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

      if ("insufficient" in result && result.insufficient) {
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

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "StockBalance",
        entityId: result.balance.id,
        previousState: result.previousBalance,
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
            "stock.view",
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
            "stock.update",
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

      const result =
        await prisma.$transaction(async (tx) => {
      /*
       * Lock both source and destination balances in deterministic order.
       *
       * Opposing transfers (A -> B and B -> A) must acquire the same
       * row locks in the same order. This prevents PostgreSQL 40P01
       * deadlocks caused by locking source first and destination second.
       */
      const stockRows = await tx.$queryRaw<
        Array<{
          id: string;
          warehouseId: string;
          binId: string | null;
        }>
      >`
        SELECT
          "id",
          "warehouseId",
          "binId"
        FROM "StockBalance"
        WHERE "tenantId" = ${claims.tenantId}::text
          AND "itemId" = ${body.itemId}::text
          AND (
            (
              "warehouseId" = ${body.sourceWarehouseId}::text
              AND (
                "binId" = ${body.sourceBinId ?? null}::text
                OR (
                  "binId" IS NULL
                  AND ${body.sourceBinId ?? null}::text IS NULL
                )
              )
            )
            OR
            (
              "warehouseId" = ${body.destinationWarehouseId}::text
              AND (
                "binId" = ${body.destinationBinId ?? null}::text
                OR (
                  "binId" IS NULL
                  AND ${body.destinationBinId ?? null}::text IS NULL
                )
              )
            )
          )
        ORDER BY "id"
        FOR UPDATE
      `;

      const sourceRow = stockRows.find(
        (row) =>
          row.warehouseId === body.sourceWarehouseId &&
          row.binId === (body.sourceBinId ?? null),
      );

      const destinationRow = stockRows.find(
        (row) =>
          row.warehouseId === body.destinationWarehouseId &&
          row.binId === (body.destinationBinId ?? null),
      );

      if (!sourceRow) {
        return {
          missingSource: true as const,
        };
      }

      const sourceBalance =
        await tx.stockBalance.findUnique({
          where: {
            id: sourceRow.id,
          },
        });

      if (!sourceBalance) {
        return {
          missingSource: true as const,
        };
      }

      const sourceQuantity =
        Number(sourceBalance.quantity);

      /*
       * The quantity check happens after the source row is locked.
       */
      if (sourceQuantity < body.quantity!) {
        return {
          insufficient: true as const,
          available: sourceQuantity,
          sourceBalance,
        };
      }

      const updatedSource =
        await tx.stockBalance.update({
          where: {
            id: sourceBalance.id,
          },
          data: {
            quantity:
              sourceQuantity - body.quantity!,
          },
        });

      let updatedDestination;

      if (destinationRow) {
        const destinationBalance =
          await tx.stockBalance.findUnique({
            where: {
              id: destinationRow.id,
            },
          });

        if (!destinationBalance) {
          throw new Error(
            "Destination stock balance disappeared while locked",
          );
        }

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
            previousSource: sourceBalance,
          };
        });

      if ("missingSource" in result && result.missingSource) {
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

      if ("insufficient" in result && result.insufficient) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                `Insufficient stock. Available: ${result.available}`,
            },
          ],
        });
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "TRANSFER",
        entityType: "StockBalance",
        entityId: result.source.id,
        previousState: result.previousSource,
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
            "stock.view",
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
