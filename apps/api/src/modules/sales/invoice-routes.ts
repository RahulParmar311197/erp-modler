import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requirePermission, AuthClaims } from "../../auth/authorization";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import { postJournalEntry } from "../accounting/journal-service";

export async function salesInvoiceRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post(
    "/api/sales/invoices",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.create")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as {
        organizationId?: string;
        customerId?: string;
        salesOrderId?: string;
        invoiceDate?: string;
        lines?: { itemId?: string; description?: string; quantity?: number; unitPrice?: number; salesOrderLineId?: string }[];
      };

      if (!body.organizationId || !body.customerId) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "organizationId and customerId are required" }] });

      const lines = body.lines ?? [];
      if (lines.length < 1) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "At least one invoice line is required" }] });

      for (const l of lines) {
        if (!l.itemId || !Number.isFinite(Number(l.quantity)) || Number(l.quantity) <= 0) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Each line requires itemId and positive quantity" }] });
      }

      const [organization, customer] = await Promise.all([
        prisma.organization.findFirst({ where: { id: body.organizationId, tenantId: claims.tenantId, active: true } }),
        prisma.customer.findFirst({ where: { id: body.customerId, tenantId: claims.tenantId, active: true } }),
      ]);

      if (!organization) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Organization not found or inactive" }] });
      if (!customer) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Customer not found or inactive" }] });

      const invoice = await prisma.$transaction(async (tx) => {
        const invoiceNumber = `SI-${Date.now()}`;
        const created = await tx.salesInvoice.create({ data: { tenantId: claims.tenantId, organizationId: organization.id, customerId: customer.id, invoiceNumber, invoiceDate: body.invoiceDate ? new Date(`${body.invoiceDate}T00:00:00.000Z`) : new Date(), status: "DRAFT" } });

        let subtotal = 0;
        for (const l of lines) {
          const qty = Number(l.quantity ?? 0);
          const unitPrice = Number(l.unitPrice ?? 0);
          subtotal += qty * unitPrice;

          await tx.salesInvoiceLine.create({ data: { tenantId: claims.tenantId, salesInvoiceId: created.id, salesOrderLineId: l.salesOrderLineId ?? undefined, itemId: l.itemId!, description: l.description ?? null, quantity: qty, unitPrice, lineTotal: qty * unitPrice } });
        }

        await tx.salesInvoice.update({ where: { id: created.id }, data: { subtotal, totalAmount: subtotal } });

        // Post journal: Debit Accounts Receivable (1100), Credit Sales (4000)
        if (subtotal > 0) {
          await postJournalEntry(tx as any, {
            tenantId: claims.tenantId,
            organizationId: organization.id,
            entryNumber: `JE-SI-${Date.now()}`,
            entryDate: created.invoiceDate,
            description: `Sales Invoice ${created.invoiceNumber}`,
            sourceType: "SalesInvoice",
            sourceId: created.id,
            lines: [
              { accountCode: "1100", description: "Accounts Receivable", debit: subtotal, credit: 0 },
              { accountCode: "4000", description: "Sales", debit: 0, credit: subtotal },
            ],
          });
        }

        return tx.salesInvoice.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
      });

      return reply.code(201).send({ data: invoice });
    },
  );
}
