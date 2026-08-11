import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../lib/prisma";

describe("Purchase receiving flow", () => {
  it("receives partially and then fully, updating stock and PO quantities", async () => {
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

      const organizationId =
        "0acbfc53-94fe-457c-8e43-b048dc454a3d";
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: {
          code: "MODLER",
        },
      });

      const tenantId = tenant.id;
      const supplierId =
        (await prisma.supplier.findFirstOrThrow({
          where: {
            tenantId,
            active: true,
          },
        })).id;
      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";


      const before = await prisma.stockBalance.findUnique({
        where: {
          tenantId_itemId_warehouseId_binId: {
            tenantId,
            itemId,
            warehouseId,
            binId,
          },
        },
      });

      const startingStock = before?.quantity ?? 0;

      const suffix = Date.now();

      // 1. Create PO for 20.
      const create = await app.inject({
        method: "POST",
        url: "/api/purchase-orders",
        headers,
        payload: {
          poNumber: `PO-RECEIVING-${suffix}`,
          organizationId,
          supplierId,
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 20,
              unitPrice: 100,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const purchaseOrderId = order.id;
      const purchaseOrderLineId = order.lines[0].id;

      expect(order.status).toBe("DRAFT");
      expect(order.lines[0].quantity).toBe("20");

      // 2. Submit.
      const submit = await app.inject({
        method: "POST",
        url: `/api/purchase-orders/${purchaseOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);
      expect(submit.json().data.status).toBe("SUBMITTED");

      // 3. Approve.
      const approve = await app.inject({
        method: "POST",
        url: `/api/purchase-orders/${purchaseOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);
      expect(approve.json().data.status).toBe("APPROVED");

      // 4. Receive first 8.
      const firstReceipt = await app.inject({
        method: "POST",
        url: "/api/goods-receipts",
        headers,
        payload: {
          receiptNumber: `GRN-RECEIVING-1-${suffix}`,
          purchaseOrderId,
          notes: "First receiving test",
          lines: [
            {
              purchaseOrderLineId,
              warehouseId,
              binId,
              quantity: 8,
            },
          ],
        },
      });

      expect(firstReceipt.statusCode).toBe(201);

      const firstData = firstReceipt.json().data;

      expect(firstData.lines[0].quantity).toBe("8");

      // 5. Verify partial state.
      const afterFirst = await prisma.purchaseOrder.findUniqueOrThrow({
        where: {
          id: purchaseOrderId,
        },
        include: {
          lines: true,
        },
      });

      expect(afterFirst.status).toBe("PARTIALLY_RECEIVED");
      expect(afterFirst.lines[0].receivedQty.toString()).toBe("8");

      const stockAfterFirst =
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

      expect(
        Number(stockAfterFirst.quantity) - Number(startingStock),
      ).toBe(8);

      // 6. Receive remaining 12.
      const secondReceipt = await app.inject({
        method: "POST",
        url: "/api/goods-receipts",
        headers,
        payload: {
          receiptNumber: `GRN-RECEIVING-2-${suffix}`,
          purchaseOrderId,
          notes: "Final receiving test",
          lines: [
            {
              purchaseOrderLineId,
              warehouseId,
              binId,
              quantity: 12,
            },
          ],
        },
      });

      expect(secondReceipt.statusCode).toBe(201);

      // 7. Verify fully received state.
      const finalOrder = await prisma.purchaseOrder.findUniqueOrThrow({
        where: {
          id: purchaseOrderId,
        },
        include: {
          lines: true,
        },
      });

      expect(finalOrder.status).toBe("RECEIVED");
      expect(finalOrder.lines[0].quantity.toString()).toBe("20");
      expect(finalOrder.lines[0].receivedQty.toString()).toBe("20");

      const finalStock = await prisma.stockBalance.findUniqueOrThrow({
        where: {
          tenantId_itemId_warehouseId_binId: {
            tenantId,
            itemId,
            warehouseId,
            binId,
          },
        },
      });

      expect(
        Number(finalStock.quantity) - Number(startingStock),
      ).toBe(20);

      const movements = await prisma.stockMovement.findMany({
        where: {
          tenantId,
          itemId,
          warehouseId,
          binId,
          movementType: "PURCHASE_RECEIPT",
          referenceType: "GOODS_RECEIPT",
        },
      });

      expect(movements.filter((movement) => movement.referenceId === order.id)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent receipt when both consume the final remaining quantity", async () => {
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

      const organizationId =
        "0acbfc53-94fe-457c-8e43-b048dc454a3d";

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const supplierId = (
        await prisma.supplier.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            active: true,
          },
        })
      ).id;

      const itemId = "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId = "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId = "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId = "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/purchase-orders",
        headers,
        payload: {
          poNumber: `PO-CONCURRENT-${suffix}`,
          organizationId,
          supplierId,
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 10,
              unitPrice: 100,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const purchaseOrderId = order.id;
      const purchaseOrderLineId = order.lines[0].id;

      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/purchase-orders/${purchaseOrderId}/submit`,
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);

      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/purchase-orders/${purchaseOrderId}/approve`,
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/goods-receipts",
          headers,
          payload: {
            receiptNumber: `GRN-CONCURRENT-1-${suffix}`,
            purchaseOrderId,
            lines: [
              {
                purchaseOrderLineId,
                warehouseId,
                binId,
                quantity: 10,
              },
            ],
          },
        }),
        app.inject({
          method: "POST",
          url: "/api/goods-receipts",
          headers,
          payload: {
            receiptNumber: `GRN-CONCURRENT-2-${suffix}`,
            purchaseOrderId,
            lines: [
              {
                purchaseOrderLineId,
                warehouseId,
                binId,
                quantity: 10,
              },
            ],
          },
        }),
      ]);

      const results = [first, second];
      const successful = results.filter(
        (result) => result.statusCode === 201,
      );
      const rejected = results.filter(
        (result) => result.statusCode === 400,
      );

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const finalOrder = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId },
        include: { lines: true },
      });

      expect(finalOrder.status).toBe("RECEIVED");
      expect(finalOrder.lines[0].receivedQty.toString()).toBe("10");

      const receipts = await prisma.goodsReceipt.findMany({
        where: { purchaseOrderId },
      });

      expect(receipts).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("rejects receiving more than the ordered quantity without changing stock", async () => {
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

      const organizationId =
        "0acbfc53-94fe-457c-8e43-b048dc454a3d";

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: {
          code: "MODLER",
        },
      });

      const tenantId = tenant.id;

      const supplierId =
        (
          await prisma.supplier.findFirstOrThrow({
            where: {
              tenantId,
              active: true,
            },
          })
        ).id;

      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";

      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";

      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";

      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const before = await prisma.stockBalance.findUnique({
        where: {
          tenantId_itemId_warehouseId_binId: {
            tenantId,
            itemId,
            warehouseId,
            binId,
          },
        },
      });

      const startingStock = before?.quantity ?? 0;
      const suffix = Date.now();

      // 1. Create PO for 20.
      const create = await app.inject({
        method: "POST",
        url: "/api/purchase-orders",
        headers,
        payload: {
          poNumber: `PO-OVERRECEIVE-${suffix}`,
          organizationId,
          supplierId,
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 20,
              unitPrice: 100,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const purchaseOrderId = order.id;
      const purchaseOrderLineId = order.lines[0].id;

      // 2. Submit.
      const submit = await app.inject({
        method: "POST",
        url: `/api/purchase-orders/${purchaseOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);

      // 3. Approve.
      const approve = await app.inject({
        method: "POST",
        url: `/api/purchase-orders/${purchaseOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);

      // 4. Attempt to receive 21 against an order for 20.
      const receipt = await app.inject({
        method: "POST",
        url: "/api/goods-receipts",
        headers,
        payload: {
          receiptNumber: `GRN-OVERRECEIVE-${suffix}`,
          purchaseOrderId,
          lines: [
            {
              purchaseOrderLineId,
              warehouseId,
              binId,
              quantity: 21,
            },
          ],
        },
      });

      expect(receipt.statusCode).toBe(400);

      // 5. PO must remain unchanged.
      const after = await prisma.purchaseOrder.findUniqueOrThrow({
        where: {
          id: purchaseOrderId,
        },
        include: {
          lines: true,
        },
      });

      expect(after.status).toBe("APPROVED");
      expect(after.lines[0].receivedQty.toString()).toBe("0");

      // 6. Stock must remain unchanged.
      const stockAfter = await prisma.stockBalance.findUnique({
        where: {
          tenantId_itemId_warehouseId_binId: {
            tenantId,
            itemId,
            warehouseId,
            binId,
          },
        },
      });

      expect(
        Number(stockAfter?.quantity ?? 0) - Number(startingStock),
      ).toBe(0);

      // 7. No goods receipt may have been created for this PO.
      const receipts = await prisma.goodsReceipt.findMany({
        where: {
          tenantId,
          purchaseOrderId,
        },
      });

      expect(receipts).toHaveLength(0);

      // 8. No stock movement may have been created for this PO attempt.
      const movements = await prisma.stockMovement.findMany({
        where: {
          tenantId,
          itemId,
          warehouseId,
          binId,
          movementType: "PURCHASE_RECEIPT",
          referenceType: "GOODS_RECEIPT",
        },
      });

      expect(
        movements.filter((movement) =>
          movement.notes?.includes(`PO ${purchaseOrderId}`),
        ),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

});
