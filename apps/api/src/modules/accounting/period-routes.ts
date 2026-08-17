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

type FiscalYearBody = {
  code?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
};

type PeriodBody = {
  fiscalYearId?: string;
  periodNumber?: number;
  code?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
};

function parseDate(value: unknown): Date | undefined {
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

export async function periodRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * List fiscal years
   */
  app.get(
    "/api/accounting/fiscal-years",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const fiscalYears = await prisma.fiscalYear.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          startDate: "desc",
        },
        include: {
          periods: {
            orderBy: {
              periodNumber: "asc",
            },
          },
        },
      });

      return {
        data: fiscalYears,
      };
    },
  );

  /*
   * Create fiscal year
   */
  app.post(
    "/api/accounting/fiscal-years",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as FiscalYearBody;

      const code = body.code?.trim();
      const name = body.name?.trim();
      const startDate = parseDate(body.startDate);
      const endDate = parseDate(body.endDate);

      if (!code || !name) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "code and name are required",
        );
      }

      if (!startDate || !endDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "startDate and endDate must use YYYY-MM-DD format",
        );
      }

      if (startDate >= endDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "startDate must be before endDate",
        );
      }

      const existing = await prisma.fiscalYear.findFirst({
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
          "Fiscal year code already exists",
        );
      }

      const overlapping = await prisma.fiscalYear.findFirst({
        where: {
          tenantId: claims.tenantId,
          startDate: {
            lt: endDate,
          },
          endDate: {
            gt: startDate,
          },
        },
      });

      if (overlapping) {
        return error(
          reply,
          409,
          "CONFLICT",
          "Fiscal year overlaps an existing fiscal year",
        );
      }

      const fiscalYear = await prisma.fiscalYear.create({
        data: {
          tenantId: claims.tenantId,
          code,
          name,
          startDate,
          endDate,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "FiscalYear",
        entityId: fiscalYear.id,
        requestId: request.id,
        newState: fiscalYear,
      });

      return reply.code(201).send({
        data: fiscalYear,
      });
    },
  );

  /*
   * Close fiscal year
   */
  app.post(
    "/api/accounting/fiscal-years/:id/close",
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

      const fiscalYear = await prisma.fiscalYear.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          periods: true,
        },
      });

      if (!fiscalYear) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Fiscal year not found",
        );
      }

      if (fiscalYear.status === "CLOSED") {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Fiscal year is already closed",
        );
      }

      const openPeriod = fiscalYear.periods.find(
        (period) => period.status === "OPEN",
      );

      if (openPeriod) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "All accounting periods must be closed before closing the fiscal year",
        );
      }

      const closed = await prisma.fiscalYear.updateMany({
        where: {
          id,
          tenantId: claims.tenantId,
          status: "OPEN",
        },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: claims.sub,
        },
      });

      if (closed.count !== 1) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Fiscal year could not be closed",
        );
      }

      const updated = await prisma.fiscalYear.findUniqueOrThrow({
        where: {
          id,
        },
        include: {
          periods: {
            orderBy: {
              periodNumber: "asc",
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CLOSE",
        entityType: "FiscalYear",
        entityId: updated.id,
        requestId: request.id,
        previousState: fiscalYear,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );

  /*
   * List accounting periods
   */
  app.get(
    "/api/accounting/periods",
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
        fiscalYearId?: unknown;
        status?: unknown;
      };

      const fiscalYearId =
        typeof query.fiscalYearId === "string" &&
        query.fiscalYearId.trim()
          ? query.fiscalYearId.trim()
          : undefined;

      const status =
        typeof query.status === "string" &&
        query.status.trim()
          ? query.status.trim().toUpperCase()
          : undefined;

      if (
        status &&
        status !== "OPEN" &&
        status !== "CLOSED"
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "status must be OPEN or CLOSED",
        );
      }

      const periods = await prisma.accountingPeriod.findMany({
        where: {
          tenantId: claims.tenantId,
          ...(fiscalYearId ? { fiscalYearId } : {}),
          ...(status
            ? {
                status: status as "OPEN" | "CLOSED",
              }
            : {}),
        },
        orderBy: [
          {
            startDate: "asc",
          },
          {
            periodNumber: "asc",
          },
        ],
        include: {
          fiscalYear: true,
        },
      });

      return {
        data: periods,
      };
    },
  );

  /*
   * Create accounting period
   */
  app.post(
    "/api/accounting/periods",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.create"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as PeriodBody;

      const fiscalYearId = body.fiscalYearId?.trim();
      const code = body.code?.trim();
      const name = body.name?.trim();
      const periodNumber = Number(body.periodNumber);
      const startDate = parseDate(body.startDate);
      const endDate = parseDate(body.endDate);

      if (!fiscalYearId || !code || !name) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "fiscalYearId, code and name are required",
        );
      }

      if (
        !Number.isInteger(periodNumber) ||
        periodNumber < 1
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "periodNumber must be a positive integer",
        );
      }

      if (!startDate || !endDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "startDate and endDate must use YYYY-MM-DD format",
        );
      }

      if (startDate >= endDate) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "startDate must be before endDate",
        );
      }

      const fiscalYear =
        await prisma.fiscalYear.findFirst({
          where: {
            id: fiscalYearId,
            tenantId: claims.tenantId,
          },
        });

      if (!fiscalYear) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Fiscal year not found",
        );
      }

      if (fiscalYear.status !== "OPEN") {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Cannot create a period in a closed fiscal year",
        );
      }

      if (
        startDate < fiscalYear.startDate ||
        endDate > fiscalYear.endDate
      ) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Accounting period must be inside the fiscal year",
        );
      }

      const existingCode =
        await prisma.accountingPeriod.findFirst({
          where: {
            tenantId: claims.tenantId,
            code,
          },
        });

      if (existingCode) {
        return error(
          reply,
          409,
          "CONFLICT",
          "Accounting period code already exists",
        );
      }

      const existingNumber =
        await prisma.accountingPeriod.findFirst({
          where: {
            fiscalYearId,
            periodNumber,
          },
        });

      if (existingNumber) {
        return error(
          reply,
          409,
          "CONFLICT",
          "Period number already exists in this fiscal year",
        );
      }

      const overlapping =
        await prisma.accountingPeriod.findFirst({
          where: {
            tenantId: claims.tenantId,
            startDate: {
              lt: endDate,
            },
            endDate: {
              gt: startDate,
            },
          },
        });

      if (overlapping) {
        return error(
          reply,
          409,
          "CONFLICT",
          "Accounting period overlaps an existing period",
        );
      }

      const period =
        await prisma.accountingPeriod.create({
          data: {
            tenantId: claims.tenantId,
            fiscalYearId,
            periodNumber,
            code,
            name,
            startDate,
            endDate,
          },
          include: {
            fiscalYear: true,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "AccountingPeriod",
        entityId: period.id,
        requestId: request.id,
        newState: period,
      });

      return reply.code(201).send({
        data: period,
      });
    },
  );

  /*
   * Close accounting period
   */
  app.post(
    "/api/accounting/periods/:id/close",
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

      const period =
        await prisma.accountingPeriod.findFirst({
          where: {
            id,
            tenantId: claims.tenantId,
          },
          include: {
            fiscalYear: true,
          },
        });

      if (!period) {
        return error(
          reply,
          404,
          "NOT_FOUND",
          "Accounting period not found",
        );
      }

      if (period.status === "CLOSED") {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Accounting period is already closed",
        );
      }

      if (period.fiscalYear.status === "CLOSED") {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Cannot close a period whose fiscal year is closed",
        );
      }

      const closed =
        await prisma.accountingPeriod.updateMany({
          where: {
            id,
            tenantId: claims.tenantId,
            status: "OPEN",
          },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            closedBy: claims.sub,
          },
        });

      if (closed.count !== 1) {
        return error(
          reply,
          400,
          "VALIDATION_ERROR",
          "Accounting period could not be closed",
        );
      }

      const updated =
        await prisma.accountingPeriod.findUniqueOrThrow({
          where: {
            id,
          },
          include: {
            fiscalYear: true,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CLOSE",
        entityType: "AccountingPeriod",
        entityId: updated.id,
        requestId: request.id,
        previousState: period,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );
}
