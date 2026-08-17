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

type GlAccountGroupBody = {
  code?: string;
  name?: string;
  nature?: string;
  parentId?: string | null;
  active?: boolean;
};

const VALID_GL_ACCOUNT_TYPES = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
] as const;

function accountingError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({
    errors: [{ code, message }],
  });
}

export async function accountingRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * Chart of Accounts - Groups
   */

  app.get(
    "/api/gl/account-groups",
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
        nature?: unknown;
        active?: unknown;
        parentId?: unknown;
      };

      const nature =
        typeof query.nature === "string" && query.nature.trim()
          ? query.nature.trim().toUpperCase()
          : undefined;

      if (
        nature &&
        !VALID_GL_ACCOUNT_TYPES.includes(
          nature as (typeof VALID_GL_ACCOUNT_TYPES)[number],
        )
      ) {
        return accountingError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Invalid GL account group nature",
        );
      }

      let active: boolean | undefined;

      if (query.active !== undefined && query.active !== "") {
        if (query.active === "true" || query.active === true) {
          active = true;
        } else if (
          query.active === "false" ||
          query.active === false
        ) {
          active = false;
        } else {
          return accountingError(
            reply,
            400,
            "VALIDATION_ERROR",
            "active must be true or false",
          );
        }
      }

      const parentId =
        typeof query.parentId === "string" &&
        query.parentId.trim()
          ? query.parentId.trim()
          : undefined;

      const groups = await prisma.glAccountGroup.findMany({
        where: {
          tenantId: claims.tenantId,
          ...(nature
            ? {
                nature: nature as
                  | "ASSET"
                  | "LIABILITY"
                  | "EQUITY"
                  | "REVENUE"
                  | "EXPENSE",
              }
            : {}),
          ...(active !== undefined ? { active } : {}),
          ...(parentId ? { parentId } : {}),
        },
        orderBy: {
          code: "asc",
        },
        include: {
          parent: true,
          children: {
            orderBy: {
              code: "asc",
            },
          },
          accounts: {
            orderBy: {
              code: "asc",
            },
          },
        },
      });

      return {
        data: groups,
      };
    },
  );

  app.get(
    "/api/gl/account-groups/:id",
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

      const group = await prisma.glAccountGroup.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          parent: true,
          children: {
            orderBy: {
              code: "asc",
            },
          },
          accounts: {
            orderBy: {
              code: "asc",
            },
          },
        },
      });

      if (!group) {
        return accountingError(
          reply,
          404,
          "NOT_FOUND",
          "GL account group not found",
        );
      }

      return {
        data: group,
      };
    },
  );

  app.post(
    "/api/gl/account-groups",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as GlAccountGroupBody;

      const code = body.code?.trim();
      const name = body.name?.trim();
      const nature = body.nature?.trim().toUpperCase();

      if (!code || !name || !nature) {
        return accountingError(
          reply,
          400,
          "VALIDATION_ERROR",
          "code, name and nature are required",
        );
      }

      if (
        !VALID_GL_ACCOUNT_TYPES.includes(
          nature as (typeof VALID_GL_ACCOUNT_TYPES)[number],
        )
      ) {
        return accountingError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Invalid GL account group nature",
        );
      }

      const existing = await prisma.glAccountGroup.findFirst({
        where: {
          tenantId: claims.tenantId,
          code,
        },
      });

      if (existing) {
        return accountingError(
          reply,
          409,
          "CONFLICT",
          "GL account group code already exists",
        );
      }

      const parentId =
        body.parentId === null
          ? null
          : body.parentId?.trim() || null;

      if (parentId) {
        const parent = await prisma.glAccountGroup.findFirst({
          where: {
            id: parentId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

        if (!parent) {
          return accountingError(
            reply,
            400,
            "VALIDATION_ERROR",
            "Parent GL account group does not exist or is inactive",
          );
        }

        if (
          parent.nature !==
          (nature as
            | "ASSET"
            | "LIABILITY"
            | "EQUITY"
            | "REVENUE"
            | "EXPENSE")
        ) {
          return accountingError(
            reply,
            400,
            "VALIDATION_ERROR",
            "Parent group nature must match the child group nature",
          );
        }
      }

      const group = await prisma.glAccountGroup.create({
        data: {
          tenantId: claims.tenantId,
          code,
          name,
          nature: nature as
            | "ASSET"
            | "LIABILITY"
            | "EQUITY"
            | "REVENUE"
            | "EXPENSE",
          parentId,
        },
        include: {
          parent: true,
          children: true,
          accounts: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "GlAccountGroup",
        entityId: group.id,
        requestId: request.id,
        newState: group,
      });

      return reply.code(201).send({
        data: group,
      });
    },
  );

  app.patch(
    "/api/gl/account-groups/:id",
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
      const body = request.body as GlAccountGroupBody;

      const group = await prisma.glAccountGroup.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
      });

      if (!group) {
        return accountingError(
          reply,
          404,
          "NOT_FOUND",
          "GL account group not found",
        );
      }

      const name =
        body.name === undefined
          ? group.name
          : typeof body.name === "string"
            ? body.name.trim()
            : "";

      const nature =
        body.nature === undefined
          ? group.nature
          : typeof body.nature === "string"
            ? body.nature.trim().toUpperCase()
            : "";

      if (!name) {
        return accountingError(
          reply,
          400,
          "VALIDATION_ERROR",
          "name cannot be empty",
        );
      }

      if (
        !VALID_GL_ACCOUNT_TYPES.includes(
          nature as (typeof VALID_GL_ACCOUNT_TYPES)[number],
        )
      ) {
        return accountingError(
          reply,
          400,
          "VALIDATION_ERROR",
          "Invalid GL account group nature",
        );
      }

      let parentId = group.parentId;

      if (body.parentId !== undefined) {
        parentId =
          body.parentId === null
            ? null
            : typeof body.parentId === "string"
              ? body.parentId.trim() || null
              : null;

        if (parentId === id) {
          return accountingError(
            reply,
            400,
            "VALIDATION_ERROR",
            "A GL account group cannot be its own parent",
          );
        }

        if (parentId) {
          const parent = await prisma.glAccountGroup.findFirst({
            where: {
              id: parentId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

          if (!parent) {
            return accountingError(
              reply,
              400,
              "VALIDATION_ERROR",
              "Parent GL account group does not exist or is inactive",
            );
          }

          if (
            parent.nature !==
            (nature as
              | "ASSET"
              | "LIABILITY"
              | "EQUITY"
              | "REVENUE"
              | "EXPENSE")
          ) {
            return accountingError(
              reply,
              400,
              "VALIDATION_ERROR",
              "Parent group nature must match the child group nature",
            );
          }

          let currentParentId: string | null = parentId;

          while (currentParentId) {
            if (currentParentId === id) {
              return accountingError(
                reply,
                400,
                "VALIDATION_ERROR",
                "GL account group hierarchy cannot contain a cycle",
              );
            }

            const ancestor: { parentId: string | null } | null =
              await prisma.glAccountGroup.findFirst({
                where: {
                  id: currentParentId,
                  tenantId: claims.tenantId,
                },
                select: {
                  parentId: true,
                },
              });

            currentParentId = ancestor?.parentId ?? null;
          }
        }
      }

      let active = group.active;

      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          return accountingError(
            reply,
            400,
            "VALIDATION_ERROR",
            "active must be true or false",
          );
        }

        active = body.active;
      }

      const updated = await prisma.glAccountGroup.update({
        where: {
          id,
        },
        data: {
          name,
          nature: nature as
            | "ASSET"
            | "LIABILITY"
            | "EQUITY"
            | "REVENUE"
            | "EXPENSE",
          parentId,
          active,
        },
        include: {
          parent: true,
          children: true,
          accounts: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "GlAccountGroup",
        entityId: updated.id,
        requestId: request.id,
        previousState: group,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );

  app.get(
    "/api/gl/accounts",
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
        code?: unknown;
        name?: unknown;
        type?: unknown;
        active?: unknown;
        organizationId?: unknown;
        groupId?: unknown;
        page?: unknown;
        pageSize?: unknown;
      };

      const code =
        typeof query.code === "string" && query.code.trim()
          ? query.code.trim()
          : undefined;

      const name =
        typeof query.name === "string" && query.name.trim()
          ? query.name.trim()
          : undefined;

      const type =
        typeof query.type === "string" && query.type.trim()
          ? query.type.trim().toUpperCase()
          : undefined;

      const organizationId =
        typeof query.organizationId === "string" &&
        query.organizationId.trim()
          ? query.organizationId.trim()
          : undefined;

      let active: boolean | undefined;

      if (query.active !== undefined && query.active !== "") {
        if (query.active === "true" || query.active === true) {
          active = true;
        } else if (
          query.active === "false" ||
          query.active === false
        ) {
          active = false;
        } else {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "active must be true or false",
              },
            ],
          });
        }
      }

      const validTypes = [
        "ASSET",
        "LIABILITY",
        "EQUITY",
        "REVENUE",
        "EXPENSE",
      ];

      if (type && !validTypes.includes(type)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Invalid GL account type",
            },
          ],
        });
      }

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
        ...(code ? { code } : {}),
        ...(name
          ? {
              name: {
                contains: name,
                mode: "insensitive" as const,
              },
            }
          : {}),
        ...(type ? { type: type as
          | "ASSET"
          | "LIABILITY"
          | "EQUITY"
          | "REVENUE"
          | "EXPENSE" } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(typeof query.groupId === "string" && query.groupId.trim()
          ? { groupId: query.groupId.trim() }
          : {}),
      };

      const [accounts, totalCount] = await Promise.all([
        prisma.glAccount.findMany({
          where,
          orderBy: {
            code: "asc",
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            organization: true,
            group: true,
          },
        }),
        prisma.glAccount.count({
          where,
        }),
      ]);

      return {
        data: accounts,
        meta: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      };
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
        groupId?: string | null;
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

      let groupId: string | null = null;

      if (body.groupId !== undefined && body.groupId !== null) {
        groupId = body.groupId.trim() || null;

        if (groupId) {
          const group = await prisma.glAccountGroup.findFirst({
            where: {
              id: groupId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

          if (!group) {
            return reply.code(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message:
                    "GL account group does not exist or is inactive",
                },
              ],
            });
          }

          if (group.nature !== type) {
            return reply.code(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message:
                    "GL account type must match the account group nature",
                },
              ],
            });
          }
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
          groupId,
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
          group: true,
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
        organizationId?: unknown;
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

      const organizationId =
        typeof query.organizationId === "string" &&
        query.organizationId.trim()
          ? query.organizationId.trim()
          : undefined;

      if (query.organizationId !== undefined && !organizationId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "organizationId must be a valid organization id",
            },
          ],
        });
      }

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

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          active: true,
          ...(organizationId ? { organizationId } : {}),
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
        organizationId?: unknown;
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

      const organizationId =
        typeof query.organizationId === "string" &&
        query.organizationId.trim()
          ? query.organizationId.trim()
          : undefined;

      if (query.organizationId !== undefined && !organizationId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "organizationId must be a valid organization id",
            },
          ],
        });
      }

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

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          active: true,
          ...(organizationId ? { organizationId } : {}),
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
        organizationId?: unknown;
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

      const organizationId =
        typeof query.organizationId === "string" &&
        query.organizationId.trim()
          ? query.organizationId.trim()
          : undefined;

      if (query.organizationId !== undefined && !organizationId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "organizationId must be a valid organization id",
            },
          ],
        });
      }

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

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          active: true,
          ...(organizationId ? { organizationId } : {}),
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
            ...(organizationId ? { organizationId } : {}),
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
