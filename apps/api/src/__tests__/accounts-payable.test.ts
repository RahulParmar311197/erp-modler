import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../lib/prisma";

const organizationId =
  "0acbfc53-94fe-457c-8e43-b048dc454a3d";

const loginPayload = {
  tenantCode: "MODLER",
  email: "admin@modler.local",
  password: "ModlerAdmin@2026!",
};

async function loginAndGetHeaders(app: Awaited<ReturnType<typeof buildApp>>) {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: loginPayload,
  });

  expect(login.statusCode).toBe(200);

  return {
    authorization: `Bearer ${login.json().data.token}`,
  };
}

describe("Accounts payable workflows", () => {
  it("creates, posts, partially pays, and fully pays a vendor bill", async () => {
    const app = await buildApp();

    try {
      const headers = await loginAndGetHeaders(app);

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const supplier = await prisma.supplier.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const item = await prisma.item.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const suffix = Date.now();
      const billNumber = `BILL-AP-TEST-${suffix}`;

      // 1. Create a draft vendor bill for 1,000.
      const create = await app.inject({
        method: "POST",
        url: "/api/vendor-bills",
        headers,
        payload: {
          organizationId,
          supplierId: supplier.id,
          billNumber,
          billDate: "2026-08-13",
          dueDate: "2026-09-13",
          currency: "INR",
          lines: [
            {
              itemId: item.id,
              description: "AP integration test",
              quantity: 10,
              unitPrice: 100,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const bill = create.json().data;

      expect(bill.status).toBe("DRAFT");
      expect(bill.totalAmount).toBe("1000");
      expect(bill.paidAmount).toBe("0");
      expect(bill.lines).toHaveLength(1);

      // 2. Post the bill.
      const post = await app.inject({
        method: "POST",
        url: `/api/vendor-bills/${bill.id}/post`,
        headers,
      });

      expect(post.statusCode).toBe(200);
      expect(post.json().data.status).toBe("POSTED");

      // 3. Verify the AP journal entry.
      const billJournal = await prisma.journalEntry.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          sourceType: "VendorBill",
          sourceId: bill.id,
        },
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      expect(billJournal.status).toBe("POSTED");
      expect(billJournal.entryDate.toISOString()).toContain("2026-08-13");
      expect(billJournal.lines).toHaveLength(2);

      const expenseLine = billJournal.lines.find(
        (line) => line.account.code === "5000",
      );

      const payableLine = billJournal.lines.find(
        (line) => line.account.code === "2000",
      );

      expect(expenseLine).toBeDefined();
      expect(payableLine).toBeDefined();

      expect(expenseLine!.debit.toString()).toBe("1000");
      expect(expenseLine!.credit.toString()).toBe("0");
      expect(payableLine!.debit.toString()).toBe("0");
      expect(payableLine!.credit.toString()).toBe("1000");

      // 4. Pay 400.
      const firstPayment = await app.inject({
        method: "POST",
        url: "/api/vendor-payments",
        headers,
        payload: {
          supplierId: supplier.id,
          vendorBillId: bill.id,
          paymentNumber: `PAY-AP-1-${suffix}`,
          paymentDate: "2026-08-13",
          amount: 400,
          currency: "INR",
        },
      });

      expect(firstPayment.statusCode).toBe(201);

      const paymentOne = firstPayment.json().data;

      expect(paymentOne.amount).toBe("400");

      const afterFirstPayment =
        await prisma.vendorBill.findUniqueOrThrow({
          where: { id: bill.id },
        });

      expect(afterFirstPayment.status).toBe("PARTIALLY_PAID");
      expect(afterFirstPayment.paidAmount.toString()).toBe("400");

      // 5. Verify payment journal.
      const paymentJournal = await prisma.journalEntry.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          sourceType: "VendorPayment",
          sourceId: paymentOne.id,
        },
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      expect(paymentJournal.status).toBe("POSTED");
      expect(paymentJournal.lines).toHaveLength(2);

      const paymentApLine = paymentJournal.lines.find(
        (line) => line.account.code === "2000",
      );

      const paymentCashLine = paymentJournal.lines.find(
        (line) => line.account.code === "1000",
      );

      expect(paymentApLine).toBeDefined();
      expect(paymentCashLine).toBeDefined();

      expect(paymentApLine!.debit.toString()).toBe("400");
      expect(paymentApLine!.credit.toString()).toBe("0");
      expect(paymentCashLine!.debit.toString()).toBe("0");
      expect(paymentCashLine!.credit.toString()).toBe("400");

      // 6. Pay the remaining 600.
      const secondPayment = await app.inject({
        method: "POST",
        url: "/api/vendor-payments",
        headers,
        payload: {
          supplierId: supplier.id,
          vendorBillId: bill.id,
          paymentNumber: `PAY-AP-2-${suffix}`,
          paymentDate: "2026-08-13",
          amount: 600,
          currency: "INR",
        },
      });

      expect(secondPayment.statusCode).toBe(201);

      const afterSecondPayment =
        await prisma.vendorBill.findUniqueOrThrow({
          where: { id: bill.id },
        });

      expect(afterSecondPayment.status).toBe("PAID");
      expect(afterSecondPayment.paidAmount.toString()).toBe("1000");

      // 7. A payment beyond the outstanding balance must be rejected.
      const overpayment = await app.inject({
        method: "POST",
        url: "/api/vendor-payments",
        headers,
        payload: {
          supplierId: supplier.id,
          vendorBillId: bill.id,
          paymentNumber: `PAY-AP-OVER-${suffix}`,
          paymentDate: "2026-08-13",
          amount: 1,
          currency: "INR",
        },
      });

      expect(overpayment.statusCode).toBe(400);
      expect(overpayment.json().errors[0].code).toBe(
        "VALIDATION_ERROR",
      );

      // 8. Only the two legitimate payments should exist.
      const payments = await prisma.vendorPayment.findMany({
        where: {
          tenantId: tenant.id,
          vendorBillId: bill.id,
        },
        orderBy: {
          paymentNumber: "asc",
        },
      });

      expect(payments).toHaveLength(2);

      expect(
        payments.reduce(
          (total, payment) => total + Number(payment.amount),
          0,
        ),
      ).toBe(1000);

      // 9. Exactly one bill journal and two payment journals.
      const journals = await prisma.journalEntry.findMany({
        where: {
          tenantId: tenant.id,
          OR: [
            {
              sourceType: "VendorBill",
              sourceId: bill.id,
            },
            {
              sourceType: "VendorPayment",
              sourceId: {
                in: payments.map((payment) => payment.id),
              },
            },
          ],
        },
      });

      expect(journals).toHaveLength(3);

      expect(
        journals.filter(
          (journal) => journal.sourceType === "VendorBill",
        ),
      ).toHaveLength(1);

      expect(
        journals.filter(
          (journal) => journal.sourceType === "VendorPayment",
        ),
      ).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("rejects duplicate payment numbers without changing the vendor bill", async () => {
    const app = await buildApp();

    try {
      const headers = await loginAndGetHeaders(app);

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const supplier = await prisma.supplier.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const item = await prisma.item.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const suffix = Date.now();
      const billNumber = `BILL-AP-DUP-${suffix}`;
      const paymentNumber = `PAY-AP-DUP-${suffix}`;

      const create = await app.inject({
        method: "POST",
        url: "/api/vendor-bills",
        headers,
        payload: {
          organizationId,
          supplierId: supplier.id,
          billNumber,
          currency: "INR",
          lines: [
            {
              itemId: item.id,
              quantity: 1,
              unitPrice: 500,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const bill = create.json().data;

      const post = await app.inject({
        method: "POST",
        url: `/api/vendor-bills/${bill.id}/post`,
        headers,
      });

      expect(post.statusCode).toBe(200);

      const first = await app.inject({
        method: "POST",
        url: "/api/vendor-payments",
        headers,
        payload: {
          supplierId: supplier.id,
          vendorBillId: bill.id,
          paymentNumber,
          amount: 100,
        },
      });

      expect(first.statusCode).toBe(201);

      const duplicate = await app.inject({
        method: "POST",
        url: "/api/vendor-payments",
        headers,
        payload: {
          supplierId: supplier.id,
          vendorBillId: bill.id,
          paymentNumber,
          amount: 100,
        },
      });

      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().errors[0].code).toBe(
        "CONFLICT",
      );

      const finalBill = await prisma.vendorBill.findUniqueOrThrow({
        where: { id: bill.id },
      });

      expect(finalBill.paidAmount.toString()).toBe("100");
      expect(finalBill.status).toBe("PARTIALLY_PAID");

      const payments = await prisma.vendorPayment.findMany({
        where: {
          tenantId: tenant.id,
          vendorBillId: bill.id,
        },
      });

      expect(payments).toHaveLength(1);
      expect(payments[0].amount.toString()).toBe("100");

      const journals = await prisma.journalEntry.findMany({
        where: {
          tenantId: tenant.id,
          sourceType: "VendorPayment",
          sourceId: payments[0].id,
        },
      });

      expect(journals).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent vendor bill with the same bill number", async () => {
    const app = await buildApp();

    try {
      const headers = await loginAndGetHeaders(app);

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const supplier = await prisma.supplier.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const item = await prisma.item.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const suffix = Date.now();
      const billNumber = `BILL-AP-CONCURRENT-DUP-${suffix}`;

      const payload = {
        organizationId,
        supplierId: supplier.id,
        billNumber,
        currency: "INR",
        lines: [
          {
            itemId: item.id,
            quantity: 1,
            unitPrice: 500,
          },
        ],
      };

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/vendor-bills",
          headers,
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/api/vendor-bills",
          headers,
          payload,
        }),
      ]);

      const results = [first, second];

      const successful = results.filter(
        (result) => result.statusCode === 201,
      );

      const rejected = results.filter(
        (result) => result.statusCode === 409,
      );

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      expect(rejected[0].json().errors[0].code).toBe("CONFLICT");
      expect(rejected[0].json().errors[0].message).toBe(
        "Vendor bill number already exists",
      );

      const bills = await prisma.vendorBill.findMany({
        where: {
          tenantId: tenant.id,
          billNumber,
        },
      });

      expect(bills).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("rejects payments against a draft vendor bill", async () => {
    const app = await buildApp();

    try {
      const headers = await loginAndGetHeaders(app);

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { code: "MODLER" },
      });

      const supplier = await prisma.supplier.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const item = await prisma.item.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/vendor-bills",
        headers,
        payload: {
          organizationId,
          supplierId: supplier.id,
          billNumber: `BILL-AP-DRAFT-${suffix}`,
          currency: "INR",
          lines: [
            {
              itemId: item.id,
              quantity: 1,
              unitPrice: 600,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const bill = create.json().data;

      expect(bill.status).toBe("DRAFT");

      const payment = await app.inject({
        method: "POST",
        url: "/api/vendor-payments",
        headers,
        payload: {
          supplierId: supplier.id,
          vendorBillId: bill.id,
          paymentNumber: `PAY-AP-DRAFT-${suffix}`,
          amount: 600,
          currency: "INR",
        },
      });

      expect(payment.statusCode).toBe(400);
      expect(payment.json().errors[0].code).toBe(
        "VALIDATION_ERROR",
      );

      const finalBill = await prisma.vendorBill.findUniqueOrThrow({
        where: { id: bill.id },
      });

      expect(finalBill.status).toBe("DRAFT");
      expect(finalBill.paidAmount.toString()).toBe("0");

      const payments = await prisma.vendorPayment.findMany({
        where: {
          tenantId: tenant.id,
          vendorBillId: bill.id,
        },
      });

      expect(payments).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

  it("allows concurrent payments only up to the outstanding vendor bill balance", async () => {
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

      const supplier = await prisma.supplier.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const item = await prisma.item.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          active: true,
        },
      });

      const suffix = Date.now();
      const billNumber = `BILL-AP-CONCURRENT-${suffix}`;

      const create = await app.inject({
        method: "POST",
        url: "/api/vendor-bills",
        headers,
        payload: {
          organizationId,
          supplierId: supplier.id,
          billNumber,
          currency: "INR",
          lines: [
            {
              itemId: item.id,
              quantity: 10,
              unitPrice: 100,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const bill = create.json().data;

      const post = await app.inject({
        method: "POST",
        url: `/api/vendor-bills/${bill.id}/post`,
        headers,
      });

      expect(post.statusCode).toBe(200);

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/vendor-payments",
          headers,
          payload: {
            supplierId: supplier.id,
            vendorBillId: bill.id,
            paymentNumber: `PAY-AP-CONCURRENT-1-${suffix}`,
            amount: 600,
            currency: "INR",
          },
        }),
        app.inject({
          method: "POST",
          url: "/api/vendor-payments",
          headers,
          payload: {
            supplierId: supplier.id,
            vendorBillId: bill.id,
            paymentNumber: `PAY-AP-CONCURRENT-2-${suffix}`,
            amount: 600,
            currency: "INR",
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

      const finalBill = await prisma.vendorBill.findUniqueOrThrow({
        where: {
          id: bill.id,
        },
      });

      expect(finalBill.paidAmount.toString()).toBe("600");
      expect(finalBill.status).toBe("PARTIALLY_PAID");

      const payments = await prisma.vendorPayment.findMany({
        where: {
          tenantId: tenant.id,
          vendorBillId: bill.id,
        },
      });

      expect(payments).toHaveLength(1);
      expect(payments[0].amount.toString()).toBe("600");

      const journals = await prisma.journalEntry.findMany({
        where: {
          tenantId: tenant.id,
          sourceType: "VendorPayment",
          sourceId: payments[0].id,
        },
      });

      expect(journals).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
