import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

import {
  authenticate,
  requirePermission,
  AuthClaims,
} from "../../auth/authorization";

import { writeAuditEvent } from "../../audit/audit";

export async function warehouseStorageRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  // ---------------------------------------------------------
  // ZONES
  // ---------------------------------------------------------

  app.get(
    "/api/warehouse-zones",
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
            "organization.view",
          ),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const zones = await prisma.warehouseZone.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
        include: {
          warehouse: true,
          bins: true,
        },
      });

      return {
        data: zones,
      };
    },
  );

  app.post(
    "/api/warehouse-zones",
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
            "organization.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        warehouseId?: string;
        code?: string;
        name?: string;
      };

      if (
        !body.warehouseId ||
        !body.code ||
        !body.name
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "warehouseId, code and name are required",
            },
          ],
        });
      }

      const warehouse =
        await prisma.warehouse.findFirst({
          where: {
            id: body.warehouseId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!warehouse) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Warehouse does not exist or is inactive",
            },
          ],
        });
      }

      const existing =
        await prisma.warehouseZone.findFirst({
          where: {
            tenantId: claims.tenantId,
            warehouseId: body.warehouseId,
            code: body.code,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message:
                "Zone code already exists in this warehouse",
            },
          ],
        });
      }

      const zone =
        await prisma.warehouseZone.create({
          data: {
            tenantId: claims.tenantId,
            warehouseId: body.warehouseId,
            code: body.code,
            name: body.name,
          },
          include: {
            warehouse: true,
            bins: true,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "WarehouseZone",
        entityId: zone.id,
        newState: zone,
      });

      return reply.code(201).send({
        data: zone,
      });
    },
  );

  // ---------------------------------------------------------
  // BINS
  // ---------------------------------------------------------

  app.get(
    "/api/warehouse-bins",
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
            "organization.view",
          ),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const bins = await prisma.warehouseBin.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
        include: {
          zone: {
            include: {
              warehouse: true,
            },
          },
        },
      });

      return {
        data: bins,
      };
    },
  );

  app.post(
    "/api/warehouse-bins",
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
            "organization.create",
          ),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const body = request.body as {
        zoneId?: string;
        code?: string;
        name?: string;
      };

      if (
        !body.zoneId ||
        !body.code ||
        !body.name
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "zoneId, code and name are required",
            },
          ],
        });
      }

      const zone =
        await prisma.warehouseZone.findFirst({
          where: {
            id: body.zoneId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!zone) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Zone does not exist or is inactive",
            },
          ],
        });
      }

      const existing =
        await prisma.warehouseBin.findFirst({
          where: {
            tenantId: claims.tenantId,
            zoneId: body.zoneId,
            code: body.code,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message:
                "Bin code already exists in this zone",
            },
          ],
        });
      }

      const bin =
        await prisma.warehouseBin.create({
          data: {
            tenantId: claims.tenantId,
            zoneId: body.zoneId,
            code: body.code,
            name: body.name,
          },
          include: {
            zone: {
              include: {
                warehouse: true,
              },
            },
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "WarehouseBin",
        entityId: bin.id,
        newState: bin,
      });

      return reply.code(201).send({
        data: bin,
      });
    },
  );
}
