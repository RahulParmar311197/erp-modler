import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../lib/prisma";

describe("Stock concurrency", () => {
  it("applies concurrent stock adjustments without losing updates", async () => {
    const app = await buildApp();

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          tenantCode: "MODLER",
          email: "admin@modler.local",
          password: "ModlerAdmin@2026!",
        },
      });

      expect(login.statusCode).toBe(200);

      const headers = {
        authorization: `Bearer ${login.json().data.token}`,
      };

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const tenantId = tenant.id;

      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";

      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";

      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

      const balanceBefore =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId,
              binId,
            },
          },
        });

      const startingQuantity =
        Number(balanceBefore.quantity);

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/stock/adjustment",
          headers,
          payload: {
            itemId,
            warehouseId,
            binId,
            quantity: 7,
            notes: `Concurrent adjustment A ${suffix}`,
          },
        }),
        app.inject({
          method: "POST",
          url: "/api/stock/adjustment",
          headers,
          payload: {
            itemId,
            warehouseId,
            binId,
            quantity: 13,
            notes: `Concurrent adjustment B ${suffix}`,
          },
        }),
      ]);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const balanceAfter =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId,
              binId,
            },
          },
        });

      expect(Number(balanceAfter.quantity)).toBe(
        startingQuantity + 20,
      );
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent transfer when both consume the final stock", async () => {
    const app = await buildApp();

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          tenantCode: "MODLER",
          email: "admin@modler.local",
          password: "ModlerAdmin@2026!",
        },
      });

      expect(login.statusCode).toBe(200);

      const headers = {
        authorization: `Bearer ${login.json().data.token}`,
      };

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const tenantId = tenant.id;

      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";

      const sourceWarehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";

      const sourceBinId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const destinationWarehouseId =
        "de48724c-cbb7-485b-9348-03c893f0f63f";

      const destinationBinId =
        "64be1d11-dd3b-4f88-be51-6ec056e4d2dd";
      const suffix = Date.now();

      const sourceBefore =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: sourceWarehouseId,
              binId: sourceBinId,
            },
          },
        });

      const sourceStartingQuantity =
        Number(sourceBefore.quantity);

      if (sourceStartingQuantity < 10) {
        throw new Error(
          `Test requires at least 10 units in source stock, found ${sourceStartingQuantity}`,
        );
      }

      /*
       * The source balance already exists in the seeded database.
       * We deliberately do not create another opening balance here.
       *
       * The test transfers exactly the current final 10 units by first
       * adjusting the source balance down to 10.
       */
      /*
   * Reset the destination balance so repeated test runs do not
   * accumulate stock from previous executions.
   */
  await prisma.stockBalance.updateMany({
    where: {
      tenantId,
      itemId,
      warehouseId: destinationWarehouseId,
      binId: destinationBinId,
    },
    data: {
      quantity: 0,
    },
  });

  const prepareSource =
        await app.inject({
          method: "POST",
          url: "/api/stock/adjustment",
          headers,
          payload: {
            itemId,
            warehouseId: sourceWarehouseId,
            binId: sourceBinId,
            quantity: 10 - sourceStartingQuantity,
            notes: `Prepare transfer concurrency test ${suffix}`,
          },
        });

      expect(prepareSource.statusCode).toBe(200);

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/stock/transfer",
          headers,
          payload: {
            itemId,
            sourceWarehouseId,
            sourceBinId,
            destinationWarehouseId,
            destinationBinId,
            quantity: 10,
            notes: `Concurrent transfer A ${suffix}`,
          },
        }),
        app.inject({
          method: "POST",
          url: "/api/stock/transfer",
          headers,
          payload: {
            itemId,
            sourceWarehouseId,
            sourceBinId,
            destinationWarehouseId,
            destinationBinId,
            quantity: 10,
            notes: `Concurrent transfer B ${suffix}`,
          },
        }),
      ]);

      expect(
        [first.statusCode, second.statusCode].sort(),
      ).toEqual([200, 400]);

      const source =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: sourceWarehouseId,
              binId: sourceBinId,
            },
          },
        });

      expect(Number(source.quantity)).toBe(0);

      const destination =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: destinationWarehouseId,
              binId: destinationBinId,
            },
          },
        });

      expect(Number(destination.quantity)).toBe(10);
    } finally {
      await app.close();
    }
  });

  it("completes opposing concurrent transfers without deadlocking", async () => {
    const app = await buildApp();

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          tenantCode: "MODLER",
          email: "admin@modler.local",
          password: "ModlerAdmin@2026!",
        },
      });

      expect(login.statusCode).toBe(200);

      const headers = {
        authorization: `Bearer ${login.json().data.token}`,
      };

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const tenantId = tenant.id;

      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";

      const warehouseA =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";

      const binA =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const warehouseB =
        "de48724c-cbb7-485b-9348-03c893f0f63f";

      const binB =
        "64be1d11-dd3b-4f88-be51-6ec056e4d2dd";

      const suffix = Date.now();

      const balanceA =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: warehouseA,
              binId: binA,
            },
          },
        });

      const balanceB =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: warehouseB,
              binId: binB,
            },
          },
        });

      const startingA = Number(balanceA.quantity);
      const startingB = Number(balanceB.quantity);

      if (startingA !== 10) {
        const prepareA = await app.inject({
          method: "POST",
          url: "/api/stock/adjustment",
          headers,
          payload: {
            itemId,
            warehouseId: warehouseA,
            binId: binA,
            quantity: 10 - startingA,
            notes: `Prepare opposing transfer A ${suffix}`,
          },
        });

        if (prepareA.statusCode !== 200) {
          console.error(
            "prepareA failed:",
            prepareA.statusCode,
            prepareA.body,
            "startingA:",
            startingA,
            "requestedAdjustment:",
            10 - startingA,
          );
        }

        expect(prepareA.statusCode).toBe(200);
      }

      if (startingB !== 10) {
        const prepareB = await app.inject({
          method: "POST",
          url: "/api/stock/adjustment",
          headers,
          payload: {
            itemId,
            warehouseId: warehouseB,
            binId: binB,
            quantity: 10 - startingB,
            notes: `Prepare opposing transfer B ${suffix}`,
          },
        });

        if (prepareB.statusCode !== 200) {
          console.error(
            "prepareB failed:",
            prepareB.statusCode,
            prepareB.body,
            "startingB:",
            startingB,
            "requestedAdjustment:",
            10 - startingB,
          );
        }

        expect(prepareB.statusCode).toBe(200);
      }

  const transfers = await Promise.race([
    Promise.all([
      app.inject({
        method: "POST",
        url: "/api/stock/transfer",
        headers,
        payload: {
          itemId,
          sourceWarehouseId: warehouseA,
          sourceBinId: binA,
          destinationWarehouseId: warehouseB,
          destinationBinId: binB,
          quantity: 10,
          notes: `Opposing transfer A-to-B ${suffix}`,
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/stock/transfer",
        headers,
        payload: {
          itemId,
          sourceWarehouseId: warehouseB,
          sourceBinId: binB,
          destinationWarehouseId: warehouseA,
          destinationBinId: binA,
          quantity: 10,
          notes: `Opposing transfer B-to-A ${suffix}`,
        },
      }),
    ]) as Promise<
      [
        Awaited<ReturnType<typeof app.inject>>,
        Awaited<ReturnType<typeof app.inject>>,
      ]
    >,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Opposing transfers timed out/deadlocked")),
        5000,
      ),
    ),
  ]);

  expect(
        transfers.every((response) => response.statusCode === 200),
      ).toBe(true);

      const finalA =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: warehouseA,
              binId: binA,
            },
          },
        });

      const finalB =
        await prisma.stockBalance.findUniqueOrThrow({
          where: {
            tenantId_itemId_warehouseId_binId: {
              tenantId,
              itemId,
              warehouseId: warehouseB,
              binId: binB,
            },
          },
        });

      expect(Number(finalA.quantity)).toBe(10);
      expect(Number(finalB.quantity)).toBe(10);
    } finally {
      await app.close();
    }
  });

});
