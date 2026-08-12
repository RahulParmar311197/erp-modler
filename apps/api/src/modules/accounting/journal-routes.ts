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

type JournalLineInput = {
  accountId?: string;
  debit?: number;
  credit?: number;
  description?: string;
};

export async function journalRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  app.get(
    "/api/gl/journal-entries",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const query = request.query as {
        fromDate?: unknown;
        toDate?: unknown;
        status?: unknown;
        sourceType?: unknown;
        organizationId?: unknown;
        page?: unknown;
        pageSize?: unknown;
      };

      const parseDate = (value: unknown): Date | null | undefined => {
        if (value === undefined || value === null || value === "") {
          return null;
        }

        if (
          typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value)
        ) {
          return undefined;
        }

        const date = new Date(`${value}T00:00:00.000Z`);

        return Number.isNaN(date.getTime()) ? undefined : date;
      };

      const fromDate = parseDate(query.fromDate);
      const toDate = parseDate(query.toDate);

      if (
        (query.fromDate !== undefined && fromDate === undefined) ||
        (query.toDate !== undefined && toDate === undefined)
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "fromDate and toDate must be valid dates in YYYY-MM-DD format",
            },
          ],
        });
      }

      if (fromDate && toDate && fromDate > toDate) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "fromDate cannot be after toDate",
            },
          ],
        });
      }

      const status =
        typeof query.status === "string" && query.status.trim()
          ? query.status.trim().toUpperCase()
          : undefined;

      if (status && status !== "DRAFT" && status !== "POSTED") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "status must be DRAFT or POSTED",
            },
          ],
        });
      }

      const sourceType =
        typeof query.sourceType === "string" && query.sourceType.trim()
          ? query.sourceType.trim()
          : undefined;

      const organizationId =
        typeof query.organizationId === "string" &&
        query.organizationId.trim()
          ? query.organizationId.trim()
          : undefined;

      const parsePositiveInt = (
        value: unknown,
        fallback: number,
      ): number | undefined => {
        if (value === undefined || value === null || value === "") {
          return fallback;
        }

        const parsed = Number(value);

        if (!Number.isInteger(parsed) || parsed < 1) {
          return undefined;
        }

        return parsed;
      };

      const page = parsePositiveInt(query.page, 1);
      const pageSize = parsePositiveInt(query.pageSize, 25);

      if (page === undefined || pageSize === undefined) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "page and pageSize must be positive integers",
            },
          ],
        });
      }

      if (pageSize > 100) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "pageSize cannot exceed 100",
            },
          ],
        });
      }

      const where = {
        tenantId: claims.tenantId,
        ...(status
          ? {
              status: status as "DRAFT" | "POSTED",
            }
          : {}),
        ...(sourceType ? { sourceType } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(fromDate || toDate
          ? {
              entryDate: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate
                  ? {
                      lte: new Date(
                        toDate.getTime() +
                          24 * 60 * 60 * 1000 -
                          1,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };

      const [entries, totalCount, totals] = await prisma.$transaction([
        prisma.journalEntry.findMany({
          where,
          orderBy: [
            {
              entryDate: "desc",
            },
            {
              id: "desc",
            },
          ],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            organization: true,
            lines: {
              include: {
                account: true,
              },
            },
          },
        }),
        prisma.journalEntry.count({
          where,
        }),
        prisma.journalLine.aggregate({
          where: {
            tenantId: claims.tenantId,
            journalEntry: where,
          },
          _sum: {
            debit: true,
            credit: true,
          },
        }),
      ]);

      const debit = Number(totals._sum.debit ?? 0);
      const credit = Number(totals._sum.credit ?? 0);

      return {
        data: entries,
        meta: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          totals: {
            debit,
            credit,
            balance: debit - credit,
          },
        },
      };
    },
  );

  app.get(
    "/api/gl/journal-entries/:id",
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

      const entry = await prisma.journalEntry.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          organization: true,
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      if (!entry) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Journal entry not found",
            },
          ],
        });
      }

      return { data: entry };
    },
  );

  app.post(
    "/api/gl/journal-entries",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        entryNumber?: string;
        entryDate?: string;
        organizationId?: string;
        description?: string;
        sourceType?: string;
        sourceId?: string;
        lines?: JournalLineInput[];
      };

      const entryNumber = body.entryNumber?.trim();
      const lines = body.lines ?? [];

      if (!entryNumber || lines.length < 2) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "entryNumber and at least two journal lines are required",
            },
          ],
        });
      }

      let debitTotal = 0;
      let creditTotal = 0;

      for (const line of lines) {
        const debit = Number(line.debit ?? 0);
        const credit = Number(line.credit ?? 0);

        if (!line.accountId) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Every journal line requires an accountId",
              },
            ],
          });
        }

        if (
          !Number.isFinite(debit) ||
          !Number.isFinite(credit) ||
          debit < 0 ||
          credit < 0 ||
          (debit > 0 && credit > 0) ||
          (debit === 0 && credit === 0)
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Each journal line must contain either a positive debit or a positive credit",
              },
            ],
          });
        }

        debitTotal += debit;
        creditTotal += credit;
      }

      if (Math.abs(debitTotal - creditTotal) > 0.000001) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: `Journal is not balanced. Debits: ${debitTotal}, Credits: ${creditTotal}`,
            },
          ],
        });
      }

      const existing = await prisma.journalEntry.findFirst({
        where: {
          tenantId: claims.tenantId,
          entryNumber,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Journal entry number already exists",
            },
          ],
        });
      }

      const accountIds = [...new Set(lines.map((line) => line.accountId!))];

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          id: {
            in: accountIds,
          },
          active: true,
        },
      });

      if (accounts.length !== accountIds.length) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "One or more GL accounts do not exist or are inactive",
            },
          ],
        });
      }

      const organizationId =
        body.organizationId ?? accounts[0]?.organizationId;

      if (!organizationId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "organizationId is required",
            },
          ],
        });
      }

      const entry = await prisma.journalEntry.create({
        data: {
          tenantId: claims.tenantId,
          organizationId,
          entryNumber,
          entryDate: body.entryDate
            ? new Date(body.entryDate)
            : new Date(),
          status: "DRAFT",
          description: body.description?.trim() || null,
          sourceType: body.sourceType?.trim() || null,
          sourceId: body.sourceId?.trim() || null,
          lines: {
            create: lines.map((line) => ({
              tenantId: claims.tenantId,
              accountId: line.accountId!,
              debit: line.debit ?? 0,
              credit: line.credit ?? 0,
              description: line.description?.trim() || null,
            })),
          },
        },
        include: {
          organization: true,
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "JournalEntry",
        entityId: entry.id,
        newState: entry,
      });

      return reply.code(201).send({
        data: entry,
      });
    },
  );

  app.post(
    "/api/gl/journal-entries/:id/post",
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

      const entry = await prisma.journalEntry.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          lines: true,
        },
      });

      if (!entry) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Journal entry not found",
            },
          ],
        });
      }

      if (entry.status !== "DRAFT") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only DRAFT journal entries can be posted",
            },
          ],
        });
      }

      const debitTotal = entry.lines.reduce(
        (sum, line) => sum + Number(line.debit),
        0,
      );

      const creditTotal = entry.lines.reduce(
        (sum, line) => sum + Number(line.credit),
        0,
      );

      if (
        entry.lines.length < 2 ||
        Math.abs(debitTotal - creditTotal) > 0.000001
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Journal entry must be balanced before posting",
            },
          ],
        });
      }

      const updated = await prisma.journalEntry.update({
        where: {
          id: entry.id,
        },
        data: {
          status: "POSTED",
        },
        include: {
          organization: true,
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "POST",
        entityType: "JournalEntry",
        entityId: updated.id,
        previousState: entry,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );

  app.get(
    "/api/gl/accounts/:accountId/ledger",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { accountId } = request.params as { accountId: string };

      const query = request.query as {
        fromDate?: unknown;
        toDate?: unknown;
      };

      const parseDate = (value: unknown): Date | null | undefined => {
        if (value === undefined || value === null || value === "") {
          return null;
        }

        if (
          typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value)
        ) {
          return undefined;
        }

        const date = new Date(`${value}T00:00:00.000Z`);

        return Number.isNaN(date.getTime()) ? undefined : date;
      };

      const fromDate = parseDate(query.fromDate);
      const toDate = parseDate(query.toDate);

      if (
        (query.fromDate !== undefined && fromDate === undefined) ||
        (query.toDate !== undefined && toDate === undefined)
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "fromDate and toDate must be valid dates in YYYY-MM-DD format",
            },
          ],
        });
      }

      if (fromDate && toDate && fromDate > toDate) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "fromDate cannot be after toDate",
            },
          ],
        });
      }

      const account = await prisma.glAccount.findFirst({
        where: {
          id: accountId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!account) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "GL account not found",
            },
          ],
        });
      }

      const openingLines = fromDate
        ? await prisma.journalLine.findMany({
            where: {
              tenantId: claims.tenantId,
              accountId,
              journalEntry: {
                status: "POSTED",
                entryDate: {
                  lt: fromDate,
                },
              },
            },
            select: {
              debit: true,
              credit: true,
            },
          })
        : [];

      const openingBalance = openingLines.reduce(
        (balance, line) =>
          balance + Number(line.debit) - Number(line.credit),
        0,
      );

      const lines = await prisma.journalLine.findMany({
        where: {
          tenantId: claims.tenantId,
          accountId,
          journalEntry: {
            status: "POSTED",
            ...(fromDate || toDate
              ? {
                  entryDate: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate
                      ? {
                          lte: new Date(
                            toDate.getTime() +
                              24 * 60 * 60 * 1000 -
                              1,
                          ),
                        }
                      : {}),
                  },
                }
              : {}),
          },
        },
        orderBy: [
          {
            journalEntry: {
              entryDate: "asc",
            },
          },
          {
            id: "asc",
          },
        ],
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              sourceId: true,
            },
          },
        },
      });

      let runningBalance = openingBalance;

      const data = lines.map((line) => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);

        runningBalance += debit - credit;

        return {
          lineId: line.id,
          journalEntryId: line.journalEntry.id,
          entryNumber: line.journalEntry.entryNumber,
          entryDate: line.journalEntry.entryDate,
          description:
            line.description ?? line.journalEntry.description,
          sourceType: line.journalEntry.sourceType,
          sourceId: line.journalEntry.sourceId,
          debit,
          credit,
          balance: runningBalance,
        };
      });

      const totals = data.reduce(
        (sum, row) => ({
          debit: sum.debit + row.debit,
          credit: sum.credit + row.credit,
          balance: row.balance,
        }),
        { debit: 0, credit: 0, balance: 0 },
      );

      return {
        data: {
          account: {
            id: account.id,
            code: account.code,
            name: account.name,
            type: account.type,
          },
          openingBalance,
          lines: data,
          totals,
        },
      };
    },
  );


}
