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
import { postJournalEntry } from "./journal-service";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type VoucherLineInput = {
  accountId?: string;
  debit?: number;
  credit?: number;
  description?: string;
};

type VoucherBody = {
  organizationId?: string;
  voucherTypeId?: string;
  fiscalYearId?: string;
  accountingPeriodId?: string;
  voucherNumber?: string;
  voucherDate?: string;
  referenceNumber?: string;
  narration?: string;
  lines?: VoucherLineInput[];
};

const VALID_VOUCHER_TYPES = [
  "SALES",
  "PURCHASE",
  "RECEIPT",
  "PAYMENT",
  "CONTRA",
  "JOURNAL",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
] as const;

function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

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

type VoucherTransactionClient = {
  voucherType: {
    findFirst: PrismaClient["voucherType"]["findFirst"];
    updateMany: PrismaClient["voucherType"]["updateMany"];
  };
};

async function generateVoucherNumber(
  tx: VoucherTransactionClient,
  tenantId: string,
  voucherTypeId: string,
) {
  const type = await tx.voucherType.findFirst({
    where: {
      id: voucherTypeId,
      tenantId,
      active: true,
    },
  });

  if (!type) {
    throw new Error("Voucher type not found or inactive");
  }

  const number = type.nextNumber;
  const padding = Math.max(1, type.numberPadding);
  const sequence = String(number).padStart(padding, "0");
  const prefix = type.prefix?.trim() ?? "";

  await tx.voucherType.updateMany({
    where: {
      id: type.id,
      tenantId,
      active: true,
      nextNumber: number,
    },
    data: {
      nextNumber: {
        increment: 1,
      },
    },
  });

  return `${prefix}${sequence}`;
}

export async function voucherRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * Voucher types
   */
  app.get(
    "/api/accounting/voucher-types",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const types = await prisma.voucherType.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
      });

      return {
        data: types,
      };
    },
  );

  /*
   * Create voucher type
   */
  app.post(
    "/api/accounting/voucher-types",
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
        voucherType?: string;
        prefix?: string;
        numberPadding?: number;
      };

      const code = body.code?.trim().toUpperCase();
      const name = body.name?.trim();
      const voucherType = body.voucherType
        ?.trim()
        .toUpperCase();

      if (!code || !name || !voucherType) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "code, name and voucherType are required",
        );
      }

      if (
        !VALID_VOUCHER_TYPES.includes(
          voucherType as (typeof VALID_VOUCHER_TYPES)[number],
        )
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Invalid voucherType",
        );
      }

      const padding =
        body.numberPadding === undefined
          ? 4
          : Number(body.numberPadding);

      if (
        !Number.isInteger(padding) ||
        padding < 1 ||
        padding > 12
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "numberPadding must be an integer between 1 and 12",
        );
      }

      const existing = await prisma.voucherType.findFirst({
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
          "Voucher type code already exists",
        );
      }

      const created = await prisma.voucherType.create({
        data: {
          tenantId: claims.tenantId,
          code,
          name,
          voucherType:
            voucherType as
              | "SALES"
              | "PURCHASE"
              | "RECEIPT"
              | "PAYMENT"
              | "CONTRA"
              | "JOURNAL"
              | "DEBIT_NOTE"
              | "CREDIT_NOTE",
          prefix: body.prefix?.trim() || null,
          numberPadding: padding,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "VoucherType",
        entityId: created.id,
        requestId: request.id,
        newState: created,
      });

      return reply.code(201).send({
        data: created,
      });
    },
  );

  /*
   * List vouchers
   */
  app.get(
    "/api/accounting/vouchers",
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
        status?: unknown;
        voucherTypeId?: unknown;
        fiscalYearId?: unknown;
        accountingPeriodId?: unknown;
        organizationId?: unknown;
        fromDate?: unknown;
        toDate?: unknown;
        page?: unknown;
        pageSize?: unknown;
      };

      const status =
        typeof query.status === "string" &&
        query.status.trim()
          ? query.status.trim().toUpperCase()
          : undefined;

      if (
        status &&
        status !== "DRAFT" &&
        status !== "POSTED" &&
        status !== "CANCELLED"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "status must be DRAFT, POSTED or CANCELLED",
        );
      }

      const fromDate = parseDate(query.fromDate);
      const toDate = parseDate(query.toDate);

      if (
        (query.fromDate !== undefined && !fromDate) ||
        (query.toDate !== undefined && !toDate)
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "fromDate and toDate must be valid dates in YYYY-MM-DD format",
        );
      }

      if (fromDate && toDate && fromDate > toDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "fromDate cannot be after toDate",
        );
      }

      const parsePositiveInt = (
        value: unknown,
        fallback: number,
      ) => {
        if (
          value === undefined ||
          value === null ||
          value === ""
        ) {
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
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "page and pageSize must be positive integers",
        );
      }

      if (pageSize > 100) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "pageSize cannot exceed 100",
        );
      }

      const where = {
        tenantId: claims.tenantId,
        ...(status
          ? {
              status: status as
                | "DRAFT"
                | "POSTED"
                | "CANCELLED",
            }
          : {}),
        ...(typeof query.voucherTypeId === "string" &&
        query.voucherTypeId.trim()
          ? { voucherTypeId: query.voucherTypeId.trim() }
          : {}),
        ...(typeof query.fiscalYearId === "string" &&
        query.fiscalYearId.trim()
          ? { fiscalYearId: query.fiscalYearId.trim() }
          : {}),
        ...(typeof query.accountingPeriodId === "string" &&
        query.accountingPeriodId.trim()
          ? {
              accountingPeriodId:
                query.accountingPeriodId.trim(),
            }
          : {}),
        ...(typeof query.organizationId === "string" &&
        query.organizationId.trim()
          ? {
              organizationId:
                query.organizationId.trim(),
            }
          : {}),
        ...(fromDate || toDate
          ? {
              voucherDate: {
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

      const [vouchers, totalCount] =
        await prisma.$transaction([
          prisma.voucher.findMany({
            where,
            orderBy: [
              {
                voucherDate: "desc",
              },
              {
                id: "desc",
              },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
              organization: true,
              voucherType: true,
              fiscalYear: true,
              accountingPeriod: true,
              lines: {
                include: {
                  account: true,
                },
              },
            },
          }),
          prisma.voucher.count({
            where,
          }),
        ]);

      return {
        data: vouchers,
        meta: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(
            totalCount / pageSize,
          ),
        },
      };
    },
  );

  /*
   * Voucher detail
   */
  app.get(
    "/api/accounting/vouchers/:id",
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

      const voucher = await prisma.voucher.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          organization: true,
          voucherType: true,
          fiscalYear: true,
          accountingPeriod: true,
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      if (!voucher) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Voucher not found",
        );
      }

      return {
        data: voucher,
      };
    },
  );

  /*
   * Create voucher
   */
  app.post(
    "/api/accounting/vouchers",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as VoucherBody;

      const lines = body.lines ?? [];

      if (lines.length < 2) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "At least two voucher lines are required",
        );
      }

      if (!body.organizationId?.trim()) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "organizationId is required",
        );
      }

      if (!body.voucherTypeId?.trim()) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "voucherTypeId is required",
        );
      }

      let debitTotal = 0;
      let creditTotal = 0;

      for (const line of lines) {
        const debit = Number(line.debit ?? 0);
        const credit = Number(line.credit ?? 0);

        if (
          !line.accountId?.trim() ||
          !Number.isFinite(debit) ||
          !Number.isFinite(credit) ||
          debit < 0 ||
          credit < 0 ||
          (debit > 0 && credit > 0) ||
          (debit === 0 && credit === 0)
        ) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Each voucher line requires either a positive debit or a positive credit and a valid accountId",
          );
        }

        debitTotal += debit;
        creditTotal += credit;
      }

      if (
        Math.abs(debitTotal - creditTotal) >
        0.000001
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          `Voucher is not balanced. Debits: ${debitTotal}, Credits: ${creditTotal}`,
        );
      }

      const accountIds = [
        ...new Set(
          lines.map((line) => line.accountId!.trim()),
        ),
      ];

      const [
        organization,
        voucherType,
        accounts,
      ] = await Promise.all([
        prisma.organization.findFirst({
          where: {
            id: body.organizationId.trim(),
            tenantId: claims.tenantId,
            active: true,
          },
        }),
        prisma.voucherType.findFirst({
          where: {
            id: body.voucherTypeId.trim(),
            tenantId: claims.tenantId,
            active: true,
          },
        }),
        prisma.glAccount.findMany({
          where: {
            tenantId: claims.tenantId,
            id: {
              in: accountIds,
            },
            active: true,
          },
        }),
      ]);

      if (!organization) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Organization does not exist or is inactive",
        );
      }

      if (!voucherType) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Voucher type does not exist or is inactive",
        );
      }

      if (accounts.length !== accountIds.length) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "One or more GL accounts do not exist or are inactive",
        );
      }

      const voucherDate = body.voucherDate
        ? parseDate(body.voucherDate)
        : new Date();

      if (!voucherDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "voucherDate must be valid and use YYYY-MM-DD format",
        );
      }

      /*
       * Validate fiscal year and accounting period independently.
       * Both must belong to the authenticated tenant.
       */
      let fiscalYearId =
        body.fiscalYearId?.trim() || undefined;

      let accountingPeriodId =
        body.accountingPeriodId?.trim() || undefined;

      if (fiscalYearId) {
        const fiscalYear =
          await prisma.fiscalYear.findFirst({
            where: {
              id: fiscalYearId,
              tenantId: claims.tenantId,
              status: "OPEN",
              startDate: {
                lte: voucherDate,
              },
              endDate: {
                gte: voucherDate,
              },
            },
          });

        if (!fiscalYear) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Fiscal year is invalid, closed, or does not contain the voucher date",
          );
        }
      }

      if (accountingPeriodId) {
        const period =
          await prisma.accountingPeriod.findFirst({
            where: {
              id: accountingPeriodId,
              tenantId: claims.tenantId,
              status: "OPEN",
              startDate: {
                lte: voucherDate,
              },
              endDate: {
                gte: voucherDate,
              },
            },
          });

        if (!period) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Accounting period is invalid, closed, or does not contain the voucher date",
          );
        }

        if (
          fiscalYearId &&
          period.fiscalYearId !== fiscalYearId
        ) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Accounting period does not belong to the selected fiscal year",
          );
        }

        if (!fiscalYearId) {
          fiscalYearId = period.fiscalYearId;
        }
      }

      /*
       * If no period/year was explicitly supplied, resolve the
       * currently open period containing the voucher date.
       */
      if (!fiscalYearId || !accountingPeriodId) {
        const period =
          await prisma.accountingPeriod.findFirst({
            where: {
              tenantId: claims.tenantId,
              status: "OPEN",
              startDate: {
                lte: voucherDate,
              },
              endDate: {
                gte: voucherDate,
              },
              ...(fiscalYearId
                ? { fiscalYearId }
                : {}),
            },
            orderBy: {
              periodNumber: "asc",
            },
          });

        if (period) {
          accountingPeriodId =
            accountingPeriodId ?? period.id;
          fiscalYearId =
            fiscalYearId ?? period.fiscalYearId;
        }
      }

      /*
       * Voucher number is generated inside the transaction.
       * A caller supplied number is allowed only when it is unique.
       */
      const requestedNumber =
        body.voucherNumber?.trim();

      const voucher = await prisma.$transaction(
        async (tx) => {
          let voucherNumber = requestedNumber;

          if (!voucherNumber) {
            voucherNumber =
              await generateVoucherNumber(
                tx,
                claims.tenantId,
                voucherType.id,
              );
          }

          const duplicate =
            await tx.voucher.findFirst({
              where: {
                tenantId: claims.tenantId,
                voucherNumber,
              },
            });

          if (duplicate) {
            throw new Error(
              "DUPLICATE_VOUCHER_NUMBER",
            );
          }

          const createdVoucher = await tx.voucher.create({
            data: {
              tenantId: claims.tenantId,
              organizationId: organization.id,
              voucherTypeId: voucherType.id,
              fiscalYearId: fiscalYearId ?? null,
              accountingPeriodId:
                accountingPeriodId ?? null,
              voucherNumber,
              voucherDate,
              status: "DRAFT",
              referenceNumber:
                body.referenceNumber?.trim() ||
                null,
              narration:
                body.narration?.trim() || null,
              totalAmount: debitTotal,
            },
          });

          await tx.voucherLine.createMany({
            data: lines.map((line) => ({
              tenantId: claims.tenantId,
              voucherId: createdVoucher.id,
              accountId: line.accountId!.trim(),
              debit: Number(line.debit ?? 0),
              credit: Number(line.credit ?? 0),
              description:
                line.description?.trim() ||
                null,
            })),
          });

          return tx.voucher.findUniqueOrThrow({
            where: {
              id: createdVoucher.id,
            },
            include: {
              organization: true,
              voucherType: true,
              fiscalYear: true,
              accountingPeriod: true,
              lines: {
                include: {
                  account: true,
                },
              },
            },
          });
        },
      );

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "Voucher",
        entityId: voucher.id,
        requestId: request.id,
        newState: voucher,
      });

      return reply.code(201).send({
        data: voucher,
      });
    },
  );

  /*
   * Post voucher
   *
   * Posting is atomic:
   *   Voucher DRAFT -> POSTED
   *   + corresponding GL JournalEntry -> POSTED
   *
   * If journal creation fails, the voucher remains DRAFT.
   */
  app.post(
    "/api/accounting/vouchers/:id/post",
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

      const voucher = await prisma.voucher.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          organization: true,
          voucherType: true,
          fiscalYear: true,
          accountingPeriod: true,
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      if (!voucher) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Voucher not found",
        );
      }

      if (voucher.status !== "DRAFT") {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Only DRAFT vouchers can be posted",
        );
      }

      const debitTotal = voucher.lines.reduce(
        (sum, line) => sum + Number(line.debit),
        0,
      );

      const creditTotal = voucher.lines.reduce(
        (sum, line) => sum + Number(line.credit),
        0,
      );

      if (
        voucher.lines.length < 2 ||
        Math.abs(debitTotal - creditTotal) > 0.000001
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Voucher must be balanced before posting",
        );
      }

      try {
        const updated = await prisma.$transaction(async (tx) => {
          /*
           * Claim the voucher first. This makes concurrent POST requests
           * mutually exclusive.
           */
          const postedCount = await tx.voucher.updateMany({
            where: {
              id: voucher.id,
              tenantId: claims.tenantId,
              status: "DRAFT",
            },
            data: {
              status: "POSTED",
            },
          });

          if (postedCount.count !== 1) {
            throw new Error("VOUCHER_ALREADY_POSTED");
          }

          /*
           * Re-read inside the transaction so period/year state is checked
           * at the actual accounting posting boundary.
           */
          const postedVoucher =
            await tx.voucher.findUniqueOrThrow({
              where: {
                id: voucher.id,
              },
              include: {
                organization: true,
                voucherType: true,
                fiscalYear: true,
                accountingPeriod: true,
                lines: {
                  include: {
                    account: true,
                  },
                },
              },
            });

          if (postedVoucher.accountingPeriodId) {
            const period =
              await tx.accountingPeriod.findFirst({
                where: {
                  id: postedVoucher.accountingPeriodId,
                  tenantId: claims.tenantId,
                  status: "OPEN",
                },
              });

            if (!period) {
              throw new Error("VOUCHER_PERIOD_CLOSED");
            }
          }

          if (postedVoucher.fiscalYearId) {
            const fiscalYear =
              await tx.fiscalYear.findFirst({
                where: {
                  id: postedVoucher.fiscalYearId,
                  tenantId: claims.tenantId,
                  status: "OPEN",
                },
              });

            if (!fiscalYear) {
              throw new Error("VOUCHER_FISCAL_YEAR_CLOSED");
            }
          }

          /*
           * A voucher already contains account IDs. The shared journal
           * service works with account codes, so translate the lines here.
           */
          await postJournalEntry(tx, {
            tenantId: claims.tenantId,
            organizationId: postedVoucher.organizationId,
            entryNumber: `JV-${postedVoucher.voucherNumber}`,
            entryDate: postedVoucher.voucherDate,
            description:
              postedVoucher.narration ??
              `Voucher ${postedVoucher.voucherNumber}`,
            sourceType: "Voucher",
            sourceId: postedVoucher.id,
            fiscalYearId:
              postedVoucher.fiscalYearId ?? undefined,
            accountingPeriodId:
              postedVoucher.accountingPeriodId ?? undefined,
            lines: postedVoucher.lines.map((line) => ({
              accountCode: line.account.code,
              description:
                line.description ?? undefined,
              debit: Number(line.debit),
              credit: Number(line.credit),
            })),
          });

          return postedVoucher;
        });

        await writeAuditEvent(prisma, {
          tenantId: claims.tenantId,
          actorUserId: claims.sub,
          action: "POST",
          entityType: "Voucher",
          entityId: updated.id,
          requestId: request.id,
          previousState: voucher,
          newState: updated,
        });

        return {
          data: updated,
        };
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === "VOUCHER_ALREADY_POSTED"
        ) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Only DRAFT vouchers can be posted",
          );
        }

        if (
          err instanceof Error &&
          err.message === "VOUCHER_PERIOD_CLOSED"
        ) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Voucher accounting period is closed or unavailable",
          );
        }

        if (
          err instanceof Error &&
          err.message === "VOUCHER_FISCAL_YEAR_CLOSED"
        ) {
          return error(
            reply,
            400,
            "VALIDATION_ERROR",
            "Voucher fiscal year is closed or unavailable",
          );
        }

        throw err;
      }
    },
  );

  /*
   * Cancel voucher
   */
  app.post(
    "/api/accounting/vouchers/:id/cancel",
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

      const voucher =
        await prisma.voucher.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
          include: {
            organization: true,
            voucherType: true,
            fiscalYear: true,
            accountingPeriod: true,
            lines: {
              include: {
                account: true,
              },
            },
          },
        });

      if (!voucher) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Voucher not found",
        );
      }

      if (voucher.status !== "DRAFT") {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Only DRAFT vouchers can be cancelled",
        );
      }

      const cancelled =
        await prisma.voucher.updateMany({
          where: {
            id,
            tenantId: claims.tenantId,
            status: "DRAFT",
          },
          data: {
            status: "CANCELLED",
          },
        });

      if (cancelled.count !== 1) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Only DRAFT vouchers can be cancelled",
        );
      }

      const updated =
        await prisma.voucher.findUniqueOrThrow({
          where: {
            id,
          },
          include: {
            organization: true,
            voucherType: true,
            fiscalYear: true,
            accountingPeriod: true,
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
        action: "CANCEL",
        entityType: "Voucher",
        entityId: updated.id,
        requestId: request.id,
        previousState: voucher,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );
}
