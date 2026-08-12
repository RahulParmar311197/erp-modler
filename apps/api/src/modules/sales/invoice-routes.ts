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
import { postJournalEntry } from "../accounting/journal-service";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

export async function salesInvoiceRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // =========================================================
  // LIST INVOICES
  // =========================================================

  app.get(
    "/api/sales-invoices",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const invoices = await prisma.salesInvoice.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          customer: true,
          organization: true,
          salesOrder: true,
          lines: {
            include: {
              item: true,
              salesOrderLine: true,
            },
          },
          payments: true,
        },
      });

      return {
        data: invoices,
      };
    },
  );

  // =========================================================
  // GET INVOICE
  // =========================================================

  app.get(
    "/api/sales-invoices/:id",
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

      const invoice = await prisma.salesInvoice.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          customer: true,
          organization: true,
          salesOrder: true,
          lines: {
            include: {
              item: true,
              salesOrderLine: true,
            },
          },
          payments: true,
        },
      });

      if (!invoice) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Sales invoice not found",
            },
          ],
        });
      }

      return {
        data: invoice,
      };
    },
  );

  // =========================================================
  // CREATE INVOICE FROM SHIPPED SALES ORDER
  // =========================================================

  app.post(
    "/api/sales-orders/:id/invoice",
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
        invoiceNumber?: string;
        invoiceDate?: string;
        dueDate?: string;
        taxAmount?: number;
        notes?: string;
      };

      const invoiceNumber = body.invoiceNumber?.trim();

      if (!invoiceNumber) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "invoiceNumber is required",
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

      if (order.status !== "SHIPPED") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only SHIPPED sales orders can be invoiced",
            },
          ],
        });
      }

      const existingInvoice = await prisma.salesInvoice.findFirst({
        where: {
          tenantId: claims.tenantId,
          salesOrderId: order.id,
        },
      });

      if (existingInvoice) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Sales order already has an invoice",
            },
          ],
        });
      }

      const existingNumber = await prisma.salesInvoice.findFirst({
        where: {
          tenantId: claims.tenantId,
          invoiceNumber,
        },
      });

      if (existingNumber) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Invoice number already exists",
            },
          ],
        });
      }

      const taxAmount = body.taxAmount ?? 0;

      if (taxAmount < 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "taxAmount cannot be negative",
            },
          ],
        });
      }

      const subtotal = order.lines.reduce(
        (sum, line) =>
          sum +
          Number(line.quantity) *
            Number(line.unitPrice),
        0,
      );

      const totalAmount = subtotal + taxAmount;

      const invoice = await prisma.salesInvoice.create({
        data: {
          tenantId: claims.tenantId,
          organizationId: order.organizationId,
          customerId: order.customerId,
          salesOrderId: order.id,
          invoiceNumber,
          status: "DRAFT",
          invoiceDate: body.invoiceDate
            ? new Date(body.invoiceDate)
            : new Date(),
          dueDate: body.dueDate
            ? new Date(body.dueDate)
            : null,
          currency: order.currency,
          subtotal,
          taxAmount,
          totalAmount,
          paidAmount: 0,
          notes: body.notes?.trim() || null,
          lines: {
            create: order.lines.map((line) => ({
              tenantId: claims.tenantId,
              salesOrderLineId: line.id,
              itemId: line.itemId,
              description: line.item.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal:
                Number(line.quantity) *
                Number(line.unitPrice),
            })),
          },
        },
        include: {
          customer: true,
          organization: true,
          salesOrder: true,
          lines: {
            include: {
              item: true,
              salesOrderLine: true,
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "SalesInvoice",
        entityId: invoice.id,
        newState: invoice,
      });

      return reply.code(201).send({
        data: invoice,
      });
    },
  );

  // =========================================================
  // POST INVOICE
  // =========================================================

  app.post(
    "/api/sales-invoices/:id/post",
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

      const invoice = await prisma.salesInvoice.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
      });

      if (!invoice) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Sales invoice not found",
            },
          ],
        });
      }

      if (invoice.status !== "DRAFT") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only DRAFT invoices can be posted",
            },
          ],
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const postedInvoice = await tx.salesInvoice.update({
          where: {
            id: invoice.id,
          },
          data: {
            status: "POSTED",
          },
        });

        await postJournalEntry(tx, {
          tenantId: claims.tenantId,
          organizationId: invoice.organizationId,
          entryNumber: `AR-${invoice.invoiceNumber}`,
          entryDate: invoice.invoiceDate,
          description: `Sales invoice ${invoice.invoiceNumber}`,
          sourceType: "SalesInvoice",
          sourceId: invoice.id,
          lines: [
            {
              accountCode: "1100",
              description: "Accounts receivable",
              debit: Number(invoice.totalAmount),
              credit: 0,
            },
            {
              accountCode: "4000",
              description: "Sales revenue",
              debit: 0,
              credit: Number(invoice.totalAmount),
            },
          ],
        });

        return tx.salesInvoice.findUniqueOrThrow({
          where: {
            id: postedInvoice.id,
          },
          include: {
            customer: true,
            organization: true,
            salesOrder: true,
            lines: {
              include: {
                item: true,
                salesOrderLine: true,
              },
            },
            payments: true,
          },
        });
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "POST",
        entityType: "SalesInvoice",
        entityId: updated.id,
        previousState: invoice,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );

  // =========================================================
  // CUSTOMER PAYMENTS
  // =========================================================

  app.post(
    "/api/sales-invoices/:id/payments",
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
        paymentNumber?: string;
        paymentDate?: string;
        amount?: number;
        notes?: string;
      };

      const paymentNumber = body.paymentNumber?.trim();
      const amount = body.amount;

      if (
        !paymentNumber ||
        amount === undefined ||
        amount <= 0
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "paymentNumber and positive amount are required",
            },
          ],
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        /*
         * Lock the invoice row before reading paidAmount.
         *
         * Without this lock, two concurrent payments can both observe
         * the same paidAmount and each approve an amount that exceeds
         * the invoice's actual outstanding balance.
         */
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
          }>
        >`
          SELECT "id"
          FROM "SalesInvoice"
          WHERE "id" = ${id}::text
            AND "tenantId" = ${claims.tenantId}::text
          FOR UPDATE
        `;

        const lockedRow = rows[0];

        if (!lockedRow) {
          return {
            ok: false as const,
            reason: "MISSING" as const,
          };
        }

        const invoice = await tx.salesInvoice.findUnique({
          where: {
            id: lockedRow.id,
          },
        });

        if (!invoice) {
          return {
            ok: false as const,
            reason: "MISSING" as const,
          };
        }

        if (
          invoice.status !== "POSTED" &&
          invoice.status !== "PARTIALLY_PAID"
        ) {
          return {
            ok: false as const,
            reason: "INVALID_STATUS" as const,
          };
        }

        const outstanding =
          Number(invoice.totalAmount) -
          Number(invoice.paidAmount);

        if (amount > outstanding) {
          return {
            ok: false as const,
            reason: "EXCEEDS_OUTSTANDING" as const,
            outstanding,
          };
        }

        const existing = await tx.customerPayment.findFirst({
          where: {
            tenantId: claims.tenantId,
            paymentNumber,
          },
        });

        if (existing) {
          return {
            ok: false as const,
            reason: "DUPLICATE_PAYMENT_NUMBER" as const,
          };
        }

        const payment = await tx.customerPayment.create({
          data: {
            tenantId: claims.tenantId,
            customerId: invoice.customerId,
            salesInvoiceId: invoice.id,
            paymentNumber,
            paymentDate: body.paymentDate
              ? new Date(body.paymentDate)
              : new Date(),
            amount,
            currency: invoice.currency,
            notes: body.notes?.trim() || null,
          },
        });

        const newPaidAmount =
          Number(invoice.paidAmount) + amount;

        const newStatus =
          newPaidAmount >= Number(invoice.totalAmount)
            ? "PAID"
            : "PARTIALLY_PAID";

        const updatedInvoice =
          await tx.salesInvoice.update({
            where: {
              id: invoice.id,
            },
            data: {
              paidAmount: newPaidAmount,
              status: newStatus,
            },
            include: {
              customer: true,
              organization: true,
              salesOrder: true,
              lines: {
                include: {
                  item: true,
                  salesOrderLine: true,
                },
              },
              payments: true,
            },
          });

        return {
          ok: true as const,
          payment,
          invoice: updatedInvoice,
          previousInvoice: invoice,
        };
      });

      if (!result.ok) {
        if (result.reason === "MISSING") {
          return reply.code(404).send({
            errors: [
              {
                code: "NOT_FOUND",
                message: "Sales invoice not found",
              },
            ],
          });
        }

        if (result.reason === "INVALID_STATUS") {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Payments can only be recorded against posted invoices",
              },
            ],
          });
        }

        if (result.reason === "EXCEEDS_OUTSTANDING") {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  `Payment exceeds outstanding amount. Outstanding: ${result.outstanding}`,
              },
            ],
          });
        }

        if (result.reason === "DUPLICATE_PAYMENT_NUMBER") {
          return reply.code(409).send({
            errors: [
              {
                code: "CONFLICT",
                message: "Payment number already exists",
              },
            ],
          });
        }

        throw new Error("Unexpected payment transaction result");
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "PAYMENT",
        entityType: "SalesInvoice",
        entityId: result.invoice.id,
        previousState: result.previousInvoice,
        newState: {
          payment: result.payment,
          invoice: result.invoice,
        },
      });

      return reply.code(201).send({
        data: {
          payment: result.payment,
          invoice: result.invoice,
        },
      });
    },
  );
}
