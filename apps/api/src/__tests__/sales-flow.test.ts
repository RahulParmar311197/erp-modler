import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

describe("Sales flow", () => {
  it("runs SO -> submit -> approve -> ship -> invoice -> post -> payment", async () => {
    const app = await buildApp();

    try {
      // Login
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

      const token = login.json().data.token;

      const headers = {
        authorization: `Bearer ${token}`,
      };

      // Existing master data from the verified smoke test.
      const organizationId =
        "0acbfc53-94fe-457c-8e43-b048dc454a3d";
      const customerId =
        "d28652d4-c3c5-4411-aa6d-4d4cabe48d58";
      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

  // 0. PREPARE STOCK FOR SALES FLOW
  const stockAdjustment = await app.inject({
    method: "POST",
    url: "/api/stock/adjustment",
    headers,
    payload: {
      itemId,
      warehouseId,
      binId,
      quantity: 1,
      notes: `Prepare sales flow test stock ${suffix}`,
    },
  });

  expect(stockAdjustment.statusCode).toBe(200);


      // 1. CREATE SALES ORDER
      const create = await app.inject({
        method: "POST",
        url: "/api/sales-orders",
        headers,
        payload: {
          orderNumber: `SO-TEST-${suffix}`,
          organizationId,
          customerId,
          requestedDate: "2026-08-15",
          currency: "INR",
          notes: "Automated sales flow test",
          lines: [
            {
              itemId,
              uomId,
              quantity: 1,
              unitPrice: 150,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;

      expect(order.status).toBe("DRAFT");
      expect(order.lines).toHaveLength(1);
      expect(order.lines[0].quantity).toBe("1");

      const salesOrderId = order.id;
      const salesOrderLineId = order.lines[0].id;

      // 2. SUBMIT
      const submit = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);
      expect(submit.json().data.status).toBe("SUBMITTED");

      // 3. APPROVE
      const approve = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);
      expect(approve.json().data.status).toBe("APPROVED");

      // 4. SHIP
      const ship = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/ship`,
        headers,
        payload: {
          shipmentNumber: `SHIP-TEST-${suffix}`,
          warehouseId,
          binId,
          notes: "Automated shipment test",
          lines: [
            {
              salesOrderLineId,
              quantity: 1,
            },
          ],
        },
      });

      const shipment = ship.json().data;

      expect(shipment.status).toBe("POSTED");
      expect(shipment.salesOrder.status).toBe("SHIPPED");
      expect(shipment.lines).toHaveLength(1);
      expect(shipment.lines[0].quantity).toBe("1");

      // 5. Verify order shipped quantity
      const shippedOrder = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(shippedOrder.statusCode).toBe(200);

      const shippedData = shippedOrder.json().data;

      expect(shippedData.status).toBe("SHIPPED");
      expect(shippedData.lines[0].shippedQty).toBe("1");

      // 6. CREATE INVOICE
      const invoiceCreate = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/invoice`,
        headers,
        payload: {
          invoiceNumber: `INV-TEST-${suffix}`,
          invoiceDate: "2026-08-11",
          dueDate: "2026-08-25",
          taxAmount: 0,
          notes: "Automated invoice test",
        },
      });

      expect(invoiceCreate.statusCode).toBe(201);

      const invoice = invoiceCreate.json().data;

      expect(invoice.status).toBe("DRAFT");
      expect(invoice.subtotal).toBe("150");
      expect(invoice.taxAmount).toBe("0");
      expect(invoice.totalAmount).toBe("150");
      expect(invoice.paidAmount).toBe("0");
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0].quantity).toBe("1");

      const invoiceId = invoice.id;

      // 7. POST INVOICE
      const postInvoice = await app.inject({
        method: "POST",
        url: `/api/sales-invoices/${invoiceId}/post`,
        headers,
        payload: {},
      });

      expect(postInvoice.statusCode).toBe(200);
      expect(postInvoice.json().data.status).toBe("POSTED");

      // 8. PAYMENT
      const payment = await app.inject({
        method: "POST",
        url: `/api/sales-invoices/${invoiceId}/payments`,
        headers,
        payload: {
          paymentNumber: `PAY-TEST-${suffix}`,
          paymentDate: "2026-08-11",
          amount: 150,
          notes: "Automated payment test",
        },
      });

      expect(payment.statusCode).toBe(201);

      const paymentData = payment.json().data;

      expect(paymentData.payment.amount).toBe("150");
      expect(paymentData.invoice.status).toBe("PAID");
      expect(paymentData.invoice.totalAmount).toBe("150");
      expect(paymentData.invoice.paidAmount).toBe("150");
      expect(paymentData.invoice.payments).toHaveLength(1);

      // 9. FINAL INVOICE RECONCILIATION
      const finalInvoice = await app.inject({
        method: "GET",
        url: `/api/sales-invoices/${invoiceId}`,
        headers,
      });

      expect(finalInvoice.statusCode).toBe(200);

      const finalInvoiceData = finalInvoice.json().data;

      expect(finalInvoiceData.status).toBe("PAID");
      expect(finalInvoiceData.totalAmount).toBe("150");
      expect(finalInvoiceData.paidAmount).toBe("150");
      expect(finalInvoiceData.payments).toHaveLength(1);

      // 10. FINAL SALES ORDER RECONCILIATION
      const finalOrder = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(finalOrder.statusCode).toBe(200);

      const finalOrderData = finalOrder.json().data;

      expect(finalOrderData.status).toBe("SHIPPED");
      expect(finalOrderData.lines[0].quantity).toBe("1");
      expect(finalOrderData.lines[0].shippedQty).toBe("1");
    } finally {
      await app.close();
    }
  });

  it("rejects shipping more than the ordered quantity", async () => {
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

      const token = login.json().data.token;

      const headers = {
        authorization: `Bearer ${token}`,
      };

      const organizationId =
        "0acbfc53-94fe-457c-8e43-b048dc454a3d";
      const customerId =
        "d28652d4-c3c5-4411-aa6d-4d4cabe48d58";
      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/sales-orders",
        headers,
        payload: {
          orderNumber: `SO-OVERQTY-${suffix}`,
          organizationId,
          customerId,
          requestedDate: "2026-08-15",
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 1,
              unitPrice: 150,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const salesOrderId = order.id;
      const salesOrderLineId = order.lines[0].id;

      const submit = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);

      const approve = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);

      const ship = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/ship`,
        headers,
        payload: {
          shipmentNumber: `SHIP-OVERQTY-${suffix}`,
          warehouseId,
          binId,
          lines: [
            {
              salesOrderLineId,
              quantity: 2,
            },
          ],
        },
      });

      expect(ship.statusCode).toBe(400);
      expect(ship.json().errors[0].code).toBe("VALIDATION_ERROR");

      const finalOrder = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(finalOrder.statusCode).toBe(200);

      const finalData = finalOrder.json().data;

      expect(finalData.status).toBe("APPROVED");
      expect(finalData.lines[0].shippedQty).toBe("0");
    } finally {
      await app.close();
    }
  });


  it("rolls back shipment when stock is insufficient", async () => {
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

      const token = login.json().data.token;

      const headers = {
        authorization: `Bearer ${token}`,
      };

      const organizationId =
        "0acbfc53-94fe-457c-8e43-b048dc454a3d";
      const customerId =
        "d28652d4-c3c5-4411-aa6d-4d4cabe48d58";
      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/sales-orders",
        headers,
        payload: {
          orderNumber: `SO-NOSTOCK-${suffix}`,
          organizationId,
          customerId,
          requestedDate: "2026-08-15",
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 999999,
              unitPrice: 150,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const salesOrderId = order.id;
      const salesOrderLineId = order.lines[0].id;

      const submit = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);

      const approve = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);

      const ship = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/ship`,
        headers,
        payload: {
          shipmentNumber: `SHIP-NOSTOCK-${suffix}`,
          warehouseId,
          binId,
          lines: [
            {
              salesOrderLineId,
              quantity: 999999,
            },
          ],
        },
      });

      expect(ship.statusCode).toBe(400);

      expect(ship.json().errors[0].code).toBe(
        "VALIDATION_ERROR",
      );

      const finalOrder = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(finalOrder.statusCode).toBe(200);

      const finalData = finalOrder.json().data;

      expect(finalData.status).toBe("APPROVED");
      expect(finalData.lines[0].shippedQty).toBe("0");

      const shipments = await app.inject({
        method: "GET",
        url: "/api/shipments",
        headers,
      });

      expect(shipments.statusCode).toBe(200);

      const createdShipment = shipments
        .json()
        .data
        .find(
          (shipment: { shipmentNumber: string }) =>
            shipment.shipmentNumber ===
            `SHIP-NOSTOCK-${suffix}`,
        );

      expect(createdShipment).toBeUndefined();
    } finally {
      await app.close();
    }
  });


  it("allows only one concurrent shipment when both consume the final remaining quantity", async () => {
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
      const customerId =
        "d28652d4-c3c5-4411-aa6d-4d4cabe48d58";
      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/sales-orders",
        headers,
        payload: {
          orderNumber: `SO-CONCURRENT-${suffix}`,
          organizationId,
          customerId,
          requestedDate: "2026-08-15",
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 1,
              unitPrice: 150,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const salesOrderId = order.id;
      const salesOrderLineId = order.lines[0].id;

      const submit = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);

      const approve = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);

      // Provide exactly 1 unit of stock so only one concurrent shipment can succeed.
  const stockAdjustment = await app.inject({
    method: "POST",
    url: "/api/stock/adjustment",
    headers,
    payload: {
      itemId,
      warehouseId,
      binId,
      quantity: 1,
    },
  });

  expect(stockAdjustment.statusCode).toBe(200);

  const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/sales-orders/${salesOrderId}/ship`,
          headers,
          payload: {
            shipmentNumber: `SHIP-CONCURRENT-1-${suffix}`,
            warehouseId,
            binId,
            lines: [
              {
                salesOrderLineId,
                quantity: 1,
              },
            ],
          },
        }),
        app.inject({
          method: "POST",
          url: `/api/sales-orders/${salesOrderId}/ship`,
          headers,
          payload: {
            shipmentNumber: `SHIP-CONCURRENT-2-${suffix}`,
            warehouseId,
            binId,
            lines: [
              {
                salesOrderLineId,
                quantity: 1,
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

      const finalOrder = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(finalOrder.statusCode).toBe(200);

      const finalData = finalOrder.json().data;

      expect(finalData.status).toBe("SHIPPED");
      expect(finalData.lines[0].shippedQty).toBe("1");

      const shipments = await app.inject({
        method: "GET",
        url: "/api/shipments",
        headers,
      });

      expect(shipments.statusCode).toBe(200);

      const createdShipments = shipments
        .json()
        .data
        .filter(
          (shipment: { shipmentNumber: string }) =>
            shipment.shipmentNumber === `SHIP-CONCURRENT-1-${suffix}` ||
            shipment.shipmentNumber === `SHIP-CONCURRENT-2-${suffix}`,
        );

      expect(createdShipments).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("supports partial shipment and completes on the remaining quantity", async () => {
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
      const customerId =
        "d28652d4-c3c5-4411-aa6d-4d4cabe48d58";
      const itemId =
        "09df66f2-e266-444a-b1d6-082798d776e2";
      const uomId =
        "46e2c63b-95ad-4069-a946-b3ada5587b9c";
      const warehouseId =
        "88c410b4-c183-443d-9d11-4cdf6b3e590c";
      const binId =
        "b16caf8c-d84e-4ea1-8065-6864007a1e59";

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/sales-orders",
        headers,
        payload: {
          orderNumber: `SO-PARTIAL-${suffix}`,
          organizationId,
          customerId,
          requestedDate: "2026-08-15",
          currency: "INR",
          lines: [
            {
              itemId,
              uomId,
              quantity: 2,
              unitPrice: 150,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const order = create.json().data;
      const salesOrderId = order.id;
      const salesOrderLineId = order.lines[0].id;

      const submit = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/submit`,
        headers,
        payload: {},
      });

      expect(submit.statusCode).toBe(200);

      const approve = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/approve`,
        headers,
        payload: {},
      });

      expect(approve.statusCode).toBe(200);

      const stockAdjustment = await app.inject({
    method: "POST",
    url: "/api/stock/adjustment",
    headers,
    payload: {
      itemId,
      warehouseId,
      binId,
      quantity: 2,
      reason: "Partial shipment test stock",
    },
  });

  expect(stockAdjustment.statusCode).toBe(200);

  // First shipment: 1 of 2.
      const firstShip = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/ship`,
        headers,
        payload: {
          shipmentNumber: `SHIP-PARTIAL-1-${suffix}`,
          warehouseId,
          binId,
          lines: [
            {
              salesOrderLineId,
              quantity: 1,
            },
          ],
        },
      });

      expect(firstShip.statusCode).toBe(201);

      const firstShipment = firstShip.json().data;

      expect(firstShipment.salesOrder.status).toBe(
        "PARTIALLY_SHIPPED",
      );

      const afterFirst = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(afterFirst.statusCode).toBe(200);

      const afterFirstData = afterFirst.json().data;

      expect(afterFirstData.status).toBe("PARTIALLY_SHIPPED");
      expect(afterFirstData.lines[0].quantity).toBe("2");
      expect(afterFirstData.lines[0].shippedQty).toBe("1");

      // Second shipment: remaining 1.
      const secondShip = await app.inject({
        method: "POST",
        url: `/api/sales-orders/${salesOrderId}/ship`,
        headers,
        payload: {
          shipmentNumber: `SHIP-PARTIAL-2-${suffix}`,
          warehouseId,
          binId,
          lines: [
            {
              salesOrderLineId,
              quantity: 1,
            },
          ],
        },
      });

      if (secondShip.statusCode !== 201) {
  console.error(
    "SECOND SHIPMENT FAILED:",
    JSON.stringify(secondShip.json(), null, 2),
  );
}
expect(secondShip.statusCode).toBe(201);

      const secondShipment = secondShip.json().data;

      expect(secondShipment.salesOrder.status).toBe("SHIPPED");

      const finalOrder = await app.inject({
        method: "GET",
        url: `/api/sales-orders/${salesOrderId}`,
        headers,
      });

      expect(finalOrder.statusCode).toBe(200);

      const finalData = finalOrder.json().data;

      expect(finalData.status).toBe("SHIPPED");
      expect(finalData.lines[0].quantity).toBe("2");
      expect(finalData.lines[0].shippedQty).toBe("2");
    } finally {
      await app.close();
    }
  });

});
