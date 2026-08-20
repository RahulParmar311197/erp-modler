import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requirePermission, AuthClaims } from "../../auth/authorization";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import { postJournalEntry } from "../accounting/journal-service";

export async function customerPaymentRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post(
    "/api/sales/customer-payments",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.create")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as { salesInvoiceId?: string; bankAccountId?: string; paymentDate?: string; amount?: number; paymentNumber?: string };

      if (!body.salesInvoiceId || !body.bankAccountId || !Number(body.amount) || Number(body.amount) <= 0) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "salesInvoiceId, bankAccountId and positive amount are required" }] });
      }

      const payment = await prisma.$transaction(async (tx) => {
        const inv = await tx.salesInvoice.findFirst({ where: { id: body.salesInvoiceId, tenantId: claims.tenantId } });
        if (!inv) throw new Error("Sales invoice not found");

        const paymentNumber = body.paymentNumber ?? `CP-${Date.now()}`;
        const created = await tx.customerPayment.create({ data: { tenantId: claims.tenantId, salesInvoiceId: inv.id, bankAccountId: body.bankAccountId, paymentNumber, paymentDate: body.paymentDate ? new Date(`${body.paymentDate}T00:00:00.000Z`) : new Date(), amount: Number(body.amount) } });

        await tx.salesInvoice.update({ where: { id: inv.id }, data: { paidAmount: { increment: Number(body.amount) } as any } as any });

        // Post journal: Debit Bank (1010), Credit Accounts Receivable (1100)
        await postJournalEntry(tx as any, {
          tenantId: claims.tenantId,
          organizationId: inv.organizationId,
          entryNumber: `JE-CP-${Date.now()}`,
          entryDate: created.paymentDate,
          description: `Customer Payment ${created.paymentNumber}`,
          sourceType: "CustomerPayment",
          sourceId: created.id,
          lines: [
            { accountCode: "1010", description: "Bank", debit: Number(body.amount), credit: 0 },
            { accountCode: "1100", description: "Accounts Receivable", debit: 0, credit: Number(body.amount) },
          ],
        });

        return tx.customerPayment.findUniqueOrThrow({ where: { id: created.id } });
      });

      return reply.code(201).send({ data: payment });
    },
  );
}
