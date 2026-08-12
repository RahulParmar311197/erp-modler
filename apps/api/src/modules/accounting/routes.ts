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

function parseReportDate(
  value: unknown,
): Date | null | undefined {
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

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

export async function accountingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  app.get(
    "/api/gl/accounts",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
        include: {
          organization: true,
        },
      });

      return { data: accounts };
    },
  );

  app.post(
    "/api/gl/accounts",
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
        code?: string;
        name?: string;
        type?: string;
        organizationId?: string;
      };

      const code = body.code?.trim();
      const name = body.name?.trim();
      const type = body.type?.trim();

      const validTypes = [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
      ];

      if (!code || !name || !type) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "code, name and type are required",
            },
          ],
        });
      }

      if (!validTypes.includes(type)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid GL account type",
            },
          ],
        });
      }

      if (body.organizationId) {
        const organization = await prisma.organization.findFirst({
          where: {
            id: body.organizationId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

        if (!organization) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Organization does not exist or is inactive",
              },
            ],
          });
        }
      }

      const existing = await prisma.glAccount.findFirst({
        where: {
          tenantId: claims.tenantId,
          code,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "GL account code already exists",
            },
          ],
        });
      }

      const account = await prisma.glAccount.create({
        data: {
          tenantId: claims.tenantId,
          organizationId: body.organizationId ?? null,
          code,
          name,
          type: type as
            | "ASSET"
            | "LIABILITY"
            | "EQUITY"
            | "REVENUE"
            | "EXPENSE",
        },
        include: {
          organization: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "GlAccount",
        entityId: account.id,
        newState: account,
      });

      return reply.code(201).send({
        data: account,
      });
    },
  );

  app.patch(
    "/api/gl/accounts/:id",
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
        name?: unknown;
        type?: unknown;
        organizationId?: unknown;
        active?: unknown;
      };

      const account = await prisma.glAccount.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
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

      const validTypes = [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
      ];

      const name =
        body.name === undefined
          ? account.name
          : typeof body.name === "string"
            ? body.name.trim()
            : "";

      const type =
        body.type === undefined
          ? account.type
          : typeof body.type === "string"
            ? body.type.trim().toUpperCase()
            : "";

      if (!name) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "name cannot be empty",
            },
          ],
        });
      }

      if (!validTypes.includes(type)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid GL account type",
            },
          ],
        });
      }

      let organizationId: string | null = account.organizationId;

      if (body.organizationId !== undefined) {
        if (
          body.organizationId !== null &&
          typeof body.organizationId !== "string"
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "organizationId must be a valid organization id or null",
              },
            ],
          });
        }

        organizationId =
          typeof body.organizationId === "string"
            ? body.organizationId.trim() || null
            : null;

        if (organizationId) {
          const organization = await prisma.organization.findFirst({
            where: {
              id: organizationId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

          if (!organization) {
            return reply.code(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message: "Organization does not exist or is inactive",
                },
              ],
            });
          }
        }
      }

      let active = account.active;

      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "active must be a boolean",
              },
            ],
          });
        }

        active = body.active;
      }

      const updated = await prisma.glAccount.update({
        where: {
          id: account.id,
        },
        data: {
          name,
          type: type as
            | "ASSET"
            | "LIABILITY"
            | "EQUITY"
            | "REVENUE"
            | "EXPENSE",
          organizationId,
          active,
        },
        include: {
          organization: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "GlAccount",
        entityId: updated.id,
        previousState: account,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );

  // =========================================================
  // TRIAL BALANCE
  // =========================================================

  app.get(
    "/api/gl/trial-balance",
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
      };

      const fromDate = parseReportDate(query.fromDate);
      const toDate = parseReportDate(query.toDate);

      if (fromDate === undefined) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "fromDate must be a valid date in YYYY-MM-DD format",
            },
          ],
        });
      }

      if (toDate === undefined) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "toDate must be a valid date in YYYY-MM-DD format",
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

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          active: true,
        },
        orderBy: {
          code: "asc",
        },
      });

      const lines = await prisma.journalLine.findMany({
        where: {
          tenantId: claims.tenantId,
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
        select: {
          accountId: true,
          debit: true,
          credit: true,
        },
      });

      const balances = new Map<
        string,
        { debit: number; credit: number }
      >();

      for (const line of lines) {
        const current = balances.get(line.accountId) ?? {
          debit: 0,
          credit: 0,
        };

        current.debit += Number(line.debit);
        current.credit += Number(line.credit);

        balances.set(line.accountId, current);
      }

      const data = accounts.map((account) => {
        const balance = balances.get(account.id) ?? {
          debit: 0,
          credit: 0,
        };

        const net = balance.debit - balance.credit;

        return {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          debit: balance.debit,
          credit: balance.credit,
          balance: net,
        };
      });

      const totals = data.reduce(
        (sum, row) => ({
          debit: sum.debit + row.debit,
          credit: sum.credit + row.credit,
          balance: sum.balance + row.balance,
        }),
        { debit: 0, credit: 0, balance: 0 },
      );

      return {
        data,
        totals,
      };
    },
  );


  // =========================================================
  // PROFIT & LOSS
  // =========================================================

  app.get(
    "/api/gl/profit-and-loss",
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
      };

      const fromDate = parseReportDate(query.fromDate);
      const toDate = parseReportDate(query.toDate);

      if (fromDate === undefined) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "fromDate must be a valid date in YYYY-MM-DD format",
            },
          ],
        });
      }

      if (toDate === undefined) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "toDate must be a valid date in YYYY-MM-DD format",
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

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          active: true,
          type: {
            in: ["REVENUE", "EXPENSE"],
          },
        },
        orderBy: {
          code: "asc",
        },
      });

      const lines = await prisma.journalLine.findMany({
        where: {
          tenantId: claims.tenantId,
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
        select: {
          accountId: true,
          debit: true,
          credit: true,
        },
      });

      const balances = new Map<
        string,
        { debit: number; credit: number }
      >();

      for (const line of lines) {
        const current = balances.get(line.accountId) ?? {
          debit: 0,
          credit: 0,
        };

        current.debit += Number(line.debit);
        current.credit += Number(line.credit);

        balances.set(line.accountId, current);
      }

      const revenue = accounts
        .filter((account) => account.type === "REVENUE")
        .map((account) => {
          const balance = balances.get(account.id) ?? {
            debit: 0,
            credit: 0,
          };

          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount: balance.credit - balance.debit,
          };
        });

      const expenses = accounts
        .filter((account) => account.type === "EXPENSE")
        .map((account) => {
          const balance = balances.get(account.id) ?? {
            debit: 0,
            credit: 0,
          };

          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount: balance.debit - balance.credit,
          };
        });

      const totalRevenue = revenue.reduce(
        (sum, row) => sum + row.amount,
        0,
      );

      const totalExpenses = expenses.reduce(
        (sum, row) => sum + row.amount,
        0,
      );

      return {
        data: {
          revenue,
          expenses,
          totalRevenue,
          totalExpenses,
          netProfit: totalRevenue - totalExpenses,
        },
      };
    },
  );

  // =========================================================
  // BALANCE SHEET
  // =========================================================

  app.get(
    "/api/gl/balance-sheet",
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
        toDate?: string;
      };

      const toDate = parseReportDate(query.toDate);

      if (toDate === undefined) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "toDate must be a valid date in YYYY-MM-DD format",
            },
          ],
        });
      }

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          active: true,
          type: {
            in: ["ASSET", "LIABILITY", "EQUITY"],
          },
        },
        orderBy: {
          code: "asc",
        },
      });

      const lines = await prisma.journalLine.findMany({
        where: {
          tenantId: claims.tenantId,
          journalEntry: {
            status: "POSTED",
            ...(toDate
              ? {
                  entryDate: {
                    lte: new Date(
                      toDate.getTime() +
                        24 * 60 * 60 * 1000 -
                        1,
                    ),
                  },
                }
              : {}),
          },
        },
        select: {
          accountId: true,
          debit: true,
          credit: true,
        },
      });

      const balances = new Map<
        string,
        { debit: number; credit: number }
      >();

      for (const line of lines) {
        const current = balances.get(line.accountId) ?? {
          debit: 0,
          credit: 0,
        };

        current.debit += Number(line.debit);
        current.credit += Number(line.credit);

        balances.set(line.accountId, current);
      }

      const assets = accounts
        .filter((account) => account.type === "ASSET")
        .map((account) => {
          const balance = balances.get(account.id) ?? {
            debit: 0,
            credit: 0,
          };

          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount: balance.debit - balance.credit,
          };
        });

      const liabilities = accounts
        .filter((account) => account.type === "LIABILITY")
        .map((account) => {
          const balance = balances.get(account.id) ?? {
            debit: 0,
            credit: 0,
          };

          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount: balance.credit - balance.debit,
          };
        });

      const equity = accounts
        .filter((account) => account.type === "EQUITY")
        .map((account) => {
          const balance = balances.get(account.id) ?? {
            debit: 0,
            credit: 0,
          };

          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount: balance.credit - balance.debit,
          };
        });

      const totalAssets = assets.reduce(
        (sum, row) => sum + row.amount,
        0,
      );

      const totalLiabilities = liabilities.reduce(
        (sum, row) => sum + row.amount,
        0,
      );

      const totalEquity = equity.reduce(
        (sum, row) => sum + row.amount,
        0,
      );

      return {
        data: {
          assets,
          liabilities,
          equity,
          totalAssets,
          totalLiabilities,
          totalEquity,
          balance:
            totalAssets - totalLiabilities - totalEquity,
        },
      };
    },
  );

}
