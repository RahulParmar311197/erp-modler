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

type BankAccountBody = {
  code?: unknown;
  name?: unknown;
  accountType?: unknown;
  organizationId?: unknown;
  glAccountId?: unknown;
  bankName?: unknown;
  accountNumber?: unknown;
  ifscCode?: unknown;
  branchName?: unknown;
  currency?: unknown;
  openingBalance?: unknown;
  active?: unknown;
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

export async function bankAccountRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * =========================================================
   * LIST BANK / CASH ACCOUNTS
   * =========================================================
   */
  app.get(
    "/api/banking/accounts",
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
        accountType?: unknown;
        organizationId?: unknown;
        active?: unknown;
      };

      const accountType =
        stringValue(query.accountType)?.toUpperCase();

      const organizationId =
        stringValue(query.organizationId);

      const activeValue =
        stringValue(query.active)?.toLowerCase();

      if (
        accountType &&
        accountType !== "BANK" &&
        accountType !== "CASH"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "accountType must be BANK or CASH",
        );
      }

      let active: boolean | undefined;

      if (activeValue !== undefined) {
        if (
          activeValue !== "true" &&
          activeValue !== "false"
        ) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "active must be true or false",
          );
        }

        active = activeValue === "true";
      }

      if (organizationId) {
        const organization =
          await prisma.organization.findFirst({
            where: {
              id: organizationId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!organization) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Organization does not exist or is inactive",
          );
        }
      }

      const accounts =
        await prisma.bankAccount.findMany({
          where: {
            tenantId: claims.tenantId,
            ...(accountType
              ? {
                  accountType:
                    accountType as "BANK" | "CASH",
                }
              : {}),
            ...(organizationId
              ? { organizationId }
              : {}),
            ...(active !== undefined
              ? { active }
              : {}),
          },
          orderBy: [
            {
              accountType: "asc",
            },
            {
              code: "asc",
            },
          ],
          include: {
            organization: true,
            glAccount: true,
          },
        });

      return {
        data: accounts,
      };
    },
  );

  /*
   * =========================================================
   * GET BANK / CASH ACCOUNT
   * =========================================================
   */
  app.get(
    "/api/banking/accounts/:id",
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

      const account =
        await prisma.bankAccount.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
          include: {
            organization: true,
            glAccount: true,
            reconciliations: {
              orderBy: {
                statementDate: "desc",
              },
              take: 10,
            },
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

      return {
        data: account,
      };
    },
  );

  /*
   * =========================================================
   * CREATE BANK / CASH ACCOUNT
   * =========================================================
   */
  app.post(
    "/api/banking/accounts",
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
        request.body as BankAccountBody;

      const code = stringValue(body.code);
      const name = stringValue(body.name);
      const accountType =
        stringValue(body.accountType)?.toUpperCase();
      const organizationId =
        stringValue(body.organizationId);
      const glAccountId =
        stringValue(body.glAccountId);

      if (
        !code ||
        !name ||
        !accountType ||
        !organizationId
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "code, name, accountType and organizationId are required",
        );
      }

      if (
        accountType !== "BANK" &&
        accountType !== "CASH"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "accountType must be BANK or CASH",
        );
      }

      const organization =
        await prisma.organization.findFirst({
          where: {
            id: organizationId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!organization) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Organization does not exist or is inactive",
        );
      }

      if (glAccountId) {
        const glAccount =
          await prisma.glAccount.findFirst({
            where: {
              id: glAccountId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!glAccount) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "GL account does not exist or is inactive",
          );
        }

        if (glAccount.type !== "ASSET") {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Bank and cash accounts must be linked to an ASSET GL account",
          );
        }
      }

      const existing =
        await prisma.bankAccount.findFirst({
          where: {
            tenantId: claims.tenantId,
            code,
          },
        });

      if (existing) {
        return error(
          reply,
          409,
          "CONFLICT",
          "Bank or cash account code already exists",
        );
      }

      const openingBalance =
        body.openingBalance === undefined
          ? 0
          : parseAmount(body.openingBalance);

      if (openingBalance === undefined) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "openingBalance must be a valid number",
        );
      }

      if (openingBalance < 0) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "openingBalance cannot be negative",
        );
      }

      const currency =
        stringValue(body.currency) ||
        "INR";

      let account;

      if (glAccountId) {
        account =
          await prisma.bankAccount.create({
            data: {
              tenantId: claims.tenantId,
              organizationId,
              glAccountId,
              code,
              name,
              accountType:
                accountType as "BANK" | "CASH",
              bankName:
                stringValue(body.bankName) ??
                null,
              accountNumber:
                stringValue(body.accountNumber) ??
                null,
              ifscCode:
                stringValue(body.ifscCode) ??
                null,
              branchName:
                stringValue(body.branchName) ??
                null,
              currency,
              openingBalance,
            },
            include: {
              organization: true,
              glAccount: true,
            },
          });
      } else {
        const result =
          await prisma.$transaction(async (tx) => {
            const existingCodes =
              await tx.glAccount.findMany({
                where: {
                  tenantId: claims.tenantId,
                  code: {
                    startsWith:
                      accountType === "BANK"
                        ? "11"
                        : "12",
                  },
                },
                select: {
                  code: true,
                },
              });

            const usedCodes = new Set(
              existingCodes.map(
                (item) => item.code,
              ),
            );

            let nextNumber =
              accountType === "BANK"
                ? 1100
                : 1200;

            while (
              usedCodes.has(
                String(nextNumber),
              )
            ) {
              nextNumber += 1;
            }

            const dedicatedGlAccount =
              await tx.glAccount.create({
                data: {
                  tenantId:
                    claims.tenantId,
                  organizationId,
                  code: String(
                    nextNumber,
                  ),
                  name,
                  type: "ASSET",
                },
              });

            return tx.bankAccount.create({
              data: {
                tenantId:
                  claims.tenantId,
                organizationId,
                glAccountId:
                  dedicatedGlAccount.id,
                code,
                name,
                accountType:
                  accountType as
                    | "BANK"
                    | "CASH",
                bankName:
                  stringValue(
                    body.bankName,
                  ) ?? null,
                accountNumber:
                  stringValue(
                    body.accountNumber,
                  ) ?? null,
                ifscCode:
                  stringValue(
                    body.ifscCode,
                  ) ?? null,
                branchName:
                  stringValue(
                    body.branchName,
                  ) ?? null,
                currency,
                openingBalance,
              },
              include: {
                organization: true,
                glAccount: true,
              },
            });
          });
        
        account = result;
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "BankAccount",
        entityId: account.id,
        requestId: request.id,
        newState: account,
      });

      return reply.code(201).send({
        data: account,
      });
    },
  );

  /*
   * =========================================================
   * UPDATE BANK / CASH ACCOUNT
   * =========================================================
   */
  app.patch(
    "/api/banking/accounts/:id",
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
        request.body as BankAccountBody;

      const account =
        await prisma.bankAccount.findFirst({
          where: {
            id,
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

      const name =
        body.name === undefined
          ? account.name
          : stringValue(body.name);

      if (!name) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "name cannot be empty",
        );
      }

      let organizationId =
        account.organizationId;

      if (body.organizationId !== undefined) {
        organizationId =
          stringValue(body.organizationId) ?? "";

        if (!organizationId) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "organizationId cannot be empty",
          );
        }

        const organization =
          await prisma.organization.findFirst({
            where: {
              id: organizationId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!organization) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Organization does not exist or is inactive",
          );
        }
      }

      let glAccountId =
        account.glAccountId;

      if (body.glAccountId !== undefined) {
        glAccountId =
          stringValue(body.glAccountId) ?? "";

        if (!glAccountId) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "glAccountId cannot be empty",
          );
        }

        const glAccount =
          await prisma.glAccount.findFirst({
            where: {
              id: glAccountId,
              tenantId: claims.tenantId,
              active: true,
            },
          });

        if (!glAccount) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "GL account does not exist or is inactive",
          );
        }

        if (glAccount.type !== "ASSET") {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Bank and cash accounts must be linked to an ASSET GL account",
          );
        }
      }

      let active = account.active;

      if (body.active !== undefined) {
        if (typeof body.active !== "boolean") {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "active must be a boolean",
          );
        }

        active = body.active;
      }

      const updated =
        await prisma.bankAccount.update({
          where: {
            id: account.id,
          },
          data: {
            name,
            organizationId,
            glAccountId,
            bankName:
              body.bankName === undefined
                ? account.bankName
                : stringValue(
                    body.bankName,
                  ) ?? null,
            accountNumber:
              body.accountNumber === undefined
                ? account.accountNumber
                : stringValue(
                    body.accountNumber,
                  ) ?? null,
            ifscCode:
              body.ifscCode === undefined
                ? account.ifscCode
                : stringValue(
                    body.ifscCode,
                  ) ?? null,
            branchName:
              body.branchName === undefined
                ? account.branchName
                : stringValue(
                    body.branchName,
                  ) ?? null,
            currency:
              body.currency === undefined
                ? account.currency
                : stringValue(
                    body.currency,
                  ) || account.currency,
            active,
          },
          include: {
            organization: true,
            glAccount: true,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "BankAccount",
        entityId: updated.id,
        requestId: request.id,
        previousState: account,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );
}
