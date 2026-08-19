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
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type ReconciliationBody = {
  bankAccountId?: unknown;
  statementDate?: unknown;
  statementRef?: unknown;
  statementBalance?: unknown;
  notes?: unknown;
};

function error(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({
    errors: [{ code, message }],
  });
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const result = value.trim();

  return result || undefined;
}

function parseAmount(value: unknown): number | undefined {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime())
    ? undefined
    : date;
}

function endOfDay(date: Date): Date {
  return new Date(
    date.getTime() +
      24 * 60 * 60 * 1000 -
      1,
  );
}

async function getBookBalance(
  prisma: PrismaClient,
  tenantId: string,
  bankAccountId: string,
  statementDate: Date,
) {
  const bankAccount =
    await prisma.bankAccount.findFirst({
      where: {
        id: bankAccountId,
        tenantId,
      },
    });

  if (!bankAccount) {
    return undefined;
  }

  const lines =
    await prisma.journalLine.findMany({
      where: {
        tenantId,
        accountId: bankAccount.glAccountId,
        journalEntry: {
          status: "POSTED",
          organizationId:
            bankAccount.organizationId,
          entryDate: {
            lte: endOfDay(statementDate),
          },
        },
      },
      select: {
        debit: true,
        credit: true,
      },
    });

  let debit = 0;
  let credit = 0;

  for (const line of lines) {
    debit += Number(line.debit);
    credit += Number(line.credit);
  }

  return {
    openingBalance: Number(
      bankAccount.openingBalance,
    ),
    debit,
    credit,
    balance:
      Number(bankAccount.openingBalance) +
      debit -
      credit,
  };
}

async function loadReconciliation(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
) {
  return prisma.bankReconciliation.findFirst({
    where: {
      id,
      tenantId,
    },
    include: {
      bankAccount: {
        include: {
          organization: true,
          glAccount: true,
        },
      },
    },
  });
}

export async function reconciliationRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * =========================================================
   * LIST RECONCILIATIONS
   * =========================================================
   */
  app.get(
    "/api/banking/reconciliations",
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
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const query = request.query as {
        bankAccountId?: unknown;
        status?: unknown;
      };

      const bankAccountId =
        stringValue(query.bankAccountId);

      const status =
        stringValue(query.status)?.toUpperCase();

      if (
        status &&
        status !== "DRAFT" &&
        status !== "RECONCILED"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "status must be DRAFT or RECONCILED",
        );
      }

      if (bankAccountId) {
        const account =
          await prisma.bankAccount.findFirst({
            where: {
              id: bankAccountId,
              tenantId: claims.tenantId,
            },
          });

        if (!account) {
          return error(
            reply,
            404,
            "NOT_FOUND",
            "Bank or cash account not found",
          );
        }
      }

      const reconciliations =
        await prisma.bankReconciliation.findMany({
          where: {
            tenantId: claims.tenantId,
            ...(bankAccountId
              ? { bankAccountId }
              : {}),
            ...(status
              ? {
                  status:
                    status as
                      | "DRAFT"
                      | "RECONCILED",
                }
              : {}),
          },
          orderBy: [
            {
              statementDate: "desc",
            },
            {
              createdAt: "desc",
            },
          ],
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      const data = await Promise.all(
        reconciliations.map(
          async (reconciliation) => {
            const book =
              await getBookBalance(
                prisma,
                claims.tenantId,
                reconciliation.bankAccountId,
                reconciliation.statementDate,
              );

            const statementBalance =
              Number(
                reconciliation.statementBalance,
              );

            return {
              ...reconciliation,
              bookBalance:
                book?.balance ?? 0,
              difference:
                statementBalance -
                (book?.balance ?? 0),
            };
          },
        ),
      );

      return {
        data,
      };
    },
  );

  /*
   * =========================================================
   * GET RECONCILIATION
   * =========================================================
   */
  app.get(
    "/api/banking/reconciliations/:id",
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
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const reconciliation =
        await loadReconciliation(
          prisma,
          claims.tenantId,
          id,
        );

      if (!reconciliation) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Bank reconciliation not found",
        );
      }

      const book =
        await getBookBalance(
          prisma,
          claims.tenantId,
          reconciliation.bankAccountId,
          reconciliation.statementDate,
        );

      const statementBalance =
        Number(
          reconciliation.statementBalance,
        );

      return {
        data: {
          ...reconciliation,
          bookBalance:
            book?.balance ?? 0,
          difference:
            statementBalance -
            (book?.balance ?? 0),
          bookSummary: book ?? {
            openingBalance: 0,
            debit: 0,
            credit: 0,
            balance: 0,
          },
        },
      };
    },
  );

  /*
   * =========================================================
   * CREATE RECONCILIATION
   * =========================================================
   */
  app.post(
    "/api/banking/reconciliations",
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
            "user.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body =
        request.body as ReconciliationBody;

      const bankAccountId =
        stringValue(body.bankAccountId);

      const statementDate =
        parseDate(body.statementDate);

      const statementRef =
        stringValue(body.statementRef);

      const statementBalance =
        parseAmount(
          body.statementBalance,
        );

      const notes =
        stringValue(body.notes);

      if (!bankAccountId) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "bankAccountId is required",
        );
      }

      if (!statementDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "statementDate must use YYYY-MM-DD format",
        );
      }

      if (statementBalance === undefined) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "statementBalance must be a valid number",
        );
      }

      const bankAccount =
        await prisma.bankAccount.findFirst({
          where: {
            id: bankAccountId,
            tenantId: claims.tenantId,
            active: true,
          },
          include: {
            organization: true,
            glAccount: true,
          },
        });

      if (!bankAccount) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Bank or cash account not found or inactive",
        );
      }

      const existing =
        await prisma.bankReconciliation.findFirst({
          where: {
            tenantId: claims.tenantId,
            bankAccountId,
            statementDate,
            status: "DRAFT",
          },
        });

      if (existing) {
        return error(
          reply,
          409,
          "CONFLICT",
          "A draft reconciliation already exists for this account and statement date",
        );
      }

      const reconciliation =
        await prisma.bankReconciliation.create({
          data: {
            tenantId: claims.tenantId,
            bankAccountId,
            statementDate,
            statementRef:
              statementRef ?? null,
            statementBalance,
            status: "DRAFT",
            notes: notes ?? null,
          },
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      const book =
        await getBookBalance(
          prisma,
          claims.tenantId,
          bankAccountId,
          statementDate,
        );

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "BankReconciliation",
        entityId: reconciliation.id,
        requestId: request.id,
        newState: reconciliation,
      });

      return reply.code(201).send({
        data: {
          ...reconciliation,
          bookBalance:
            book?.balance ?? 0,
          difference:
            statementBalance -
            (book?.balance ?? 0),
        },
      });
    },
  );

  /*
   * =========================================================
   * UPDATE DRAFT RECONCILIATION
   * =========================================================
   */
  app.patch(
    "/api/banking/reconciliations/:id",
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
            "user.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const body =
        request.body as ReconciliationBody;

      const reconciliation =
        await prisma.bankReconciliation.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
          include: {
            bankAccount: true,
          },
        });

      if (!reconciliation) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Bank reconciliation not found",
        );
      }

      if (
        reconciliation.status !== "DRAFT"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Only DRAFT reconciliations can be updated",
        );
      }

      let statementDate =
        reconciliation.statementDate;

      if (
        body.statementDate !== undefined
      ) {
        const parsed =
          parseDate(body.statementDate);

        if (!parsed) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "statementDate must use YYYY-MM-DD format",
          );
        }

        statementDate = parsed;
      }

      let statementBalance =
        Number(
          reconciliation.statementBalance,
        );

      if (
        body.statementBalance !== undefined
      ) {
        const parsed =
          parseAmount(
            body.statementBalance,
          );

        if (parsed === undefined) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "statementBalance must be a valid number",
          );
        }

        statementBalance = parsed;
      }

      const statementRef =
        body.statementRef === undefined
          ? reconciliation.statementRef
          : stringValue(
              body.statementRef,
            ) ?? null;

      const notes =
        body.notes === undefined
          ? reconciliation.notes
          : stringValue(body.notes) ??
            null;

      const updated =
        await prisma.bankReconciliation.update({
          where: {
            id: reconciliation.id,
          },
          data: {
            statementDate,
            statementRef,
            statementBalance,
            notes,
          },
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      const book =
        await getBookBalance(
          prisma,
          claims.tenantId,
          updated.bankAccountId,
          statementDate,
        );

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "BankReconciliation",
        entityId: updated.id,
        requestId: request.id,
        previousState: reconciliation,
        newState: updated,
      });

      return {
        data: {
          ...updated,
          bookBalance:
            book?.balance ?? 0,
          difference:
            statementBalance -
            (book?.balance ?? 0),
        },
      };
    },
  );

  /*
   * =========================================================
   * RECONCILE
   * =========================================================
   *
   * Current schema does not contain reconciliation line /
   * matching tables. Therefore reconciliation means that
   * the statement balance agrees with the calculated posted
   * book balance for the bank GL account.
   */
  app.post(
    "/api/banking/reconciliations/:id/reconcile",
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
            "user.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const reconciliation =
        await prisma.bankReconciliation.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      if (!reconciliation) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Bank reconciliation not found",
        );
      }

      if (
        reconciliation.status !== "DRAFT"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Only DRAFT reconciliations can be reconciled",
        );
      }

      const book =
        await getBookBalance(
          prisma,
          claims.tenantId,
          reconciliation.bankAccountId,
          reconciliation.statementDate,
        );

      const bookBalance =
        book?.balance ?? 0;

      const statementBalance =
        Number(
          reconciliation.statementBalance,
        );

      const difference =
        statementBalance -
        bookBalance;

      if (
        Math.abs(difference) >
        0.000001
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          `Statement balance does not match book balance. Difference: ${difference}`,
        );
      }

      const updated =
        await prisma.bankReconciliation.update({
          where: {
            id: reconciliation.id,
          },
          data: {
            status: "RECONCILED",
            reconciledAt: new Date(),
            reconciledBy: claims.sub,
          },
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "RECONCILE",
        entityType: "BankReconciliation",
        entityId: updated.id,
        requestId: request.id,
        previousState: reconciliation,
        newState: updated,
      });

      return {
        data: {
          ...updated,
          bookBalance,
          difference: 0,
        },
      };
    },
  );

  /*
   * =========================================================
   * UNRECONCILE
   * =========================================================
   */
  app.post(
    "/api/banking/reconciliations/:id/unreconcile",
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
            "user.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const reconciliation =
        await prisma.bankReconciliation.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      if (!reconciliation) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Bank reconciliation not found",
        );
      }

      if (
        reconciliation.status !==
        "RECONCILED"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Only RECONCILED records can be unreconciled",
        );
      }

      const updated =
        await prisma.bankReconciliation.update({
          where: {
            id: reconciliation.id,
          },
          data: {
            status: "DRAFT",
            reconciledAt: null,
            reconciledBy: null,
          },
          include: {
            bankAccount: {
              include: {
                organization: true,
                glAccount: true,
              },
            },
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UNRECONCILE",
        entityType: "BankReconciliation",
        entityId: updated.id,
        requestId: request.id,
        previousState: reconciliation,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );
}
