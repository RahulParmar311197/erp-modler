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

import { prisma } from "../../lib/prisma";

export async function partyLedgerRoutes(app: FastifyInstance) {
  // =========================================================
  // CUSTOMER LEDGER
  // =========================================================

  app.get(
    "/api/customers/:customerId/ledger",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { customerId } = request.params as { customerId: string };

      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          tenantId: claims.tenantId,
        },
      });

      if (!customer) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Customer not found",
            },
          ],
        });
      }

      const invoices = await prisma.salesInvoice.findMany({
        where: {
          tenantId: claims.tenantId,
          customerId,
        },
        orderBy: {
          invoiceDate: "asc",
        },
        include: {
          payments: true,
        },
      });

      const rows: Array<{
        date: Date;
        type: string;
        reference: string;
        description: string;
        debit: number;
        credit: number;
        balance: number;
        sourceId: string;
      }> = [];

      let balance = 0;

      for (const invoice of invoices) {
        const invoiceAmount = Number(invoice.totalAmount);

        balance += invoiceAmount;

        rows.push({
          date: invoice.invoiceDate,
          type: "INVOICE",
          reference: invoice.invoiceNumber,
          description: `Sales invoice ${invoice.invoiceNumber}`,
          debit: invoiceAmount,
          credit: 0,
          balance,
          sourceId: invoice.id,
        });

        for (const payment of invoice.payments) {
          const paymentAmount = Number(payment.amount);

          balance -= paymentAmount;

          rows.push({
            date: payment.paymentDate,
            type: "PAYMENT",
            reference: payment.paymentNumber,
            description: `Customer payment ${payment.paymentNumber}`,
            debit: 0,
            credit: paymentAmount,
            balance,
            sourceId: payment.id,
          });
        }
      }

      rows.sort((a, b) => {
        const dateCompare =
          new Date(a.date).getTime() -
          new Date(b.date).getTime();

        if (dateCompare !== 0) return dateCompare;

        return a.reference.localeCompare(b.reference);
      });

      // Recalculate running balance after chronological sort.
      balance = 0;

      for (const row of rows) {
        balance += row.debit;
        balance -= row.credit;
        row.balance = balance;
      }

      return {
        data: {
          partyType: "CUSTOMER",
          party: customer,
          openingBalance: 0,
          closingBalance: balance,
          rows,
        },
      };
    },
  );

  // =========================================================
  // SUPPLIER LEDGER
  // =========================================================

  app.get(
    "/api/suppliers/:supplierId/ledger",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { supplierId } = request.params as { supplierId: string };

      const supplier = await prisma.supplier.findFirst({
        where: {
          id: supplierId,
          tenantId: claims.tenantId,
        },
      });

      if (!supplier) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Supplier not found",
            },
          ],
        });
      }

      const bills = await prisma.vendorBill.findMany({
        where: {
          tenantId: claims.tenantId,
          supplierId,
        },
        orderBy: {
          billDate: "asc",
        },
        include: {
          payments: true,
        },
      });

      const rows: Array<{
        date: Date;
        type: string;
        reference: string;
        description: string;
        debit: number;
        credit: number;
        balance: number;
        sourceId: string;
      }> = [];

      let balance = 0;

      for (const bill of bills) {
        const billAmount = Number(bill.totalAmount);

        // Supplier payable increases with a credit.
        balance += billAmount;

        rows.push({
          date: bill.billDate,
          type: "BILL",
          reference: bill.billNumber,
          description: `Vendor bill ${bill.billNumber}`,
          debit: 0,
          credit: billAmount,
          balance,
          sourceId: bill.id,
        });

        for (const payment of bill.payments) {
          const paymentAmount = Number(payment.amount);

          balance -= paymentAmount;

          rows.push({
            date: payment.paymentDate,
            type: "PAYMENT",
            reference: payment.paymentNumber,
            description: `Supplier payment ${payment.paymentNumber}`,
            debit: paymentAmount,
            credit: 0,
            balance,
            sourceId: payment.id,
          });
        }
      }

      rows.sort((a, b) => {
        const dateCompare =
          new Date(a.date).getTime() -
          new Date(b.date).getTime();

        if (dateCompare !== 0) return dateCompare;

        return a.reference.localeCompare(b.reference);
      });

      balance = 0;

      for (const row of rows) {
        balance += row.credit;
        balance -= row.debit;
        row.balance = balance;
      }

      return {
        data: {
          partyType: "SUPPLIER",
          party: supplier,
          openingBalance: 0,
          closingBalance: balance,
          rows,
        },
      };
    },
  );
}
