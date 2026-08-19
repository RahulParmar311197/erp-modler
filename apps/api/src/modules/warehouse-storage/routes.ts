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
            "warehouse.view",
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
            "warehouse.create",
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


  app.put(
    "/api/warehouse-zones/:id",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "warehouse.update"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };
      const body = request.body as {
        code?: string;
        name?: string;
        active?: boolean;
      };

      const zone = await prisma.warehouseZone.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          warehouse: true,
          bins: true,
        },
      });

      if (!zone) {
        return reply.code(404).send({
          errors: [{ code: "NOT_FOUND", message: "Warehouse zone not found" }],
        });
      }

      if (body.code && body.code !== zone.code) {
        const duplicate = await prisma.warehouseZone.findFirst({
          where: {
            tenantId: claims.tenantId,
            warehouseId: zone.warehouseId,
            code: body.code,
            NOT: { id },
          },
        });

        if (duplicate) {
          return reply.code(409).send({
            errors: [{
              code: "DUPLICATE_ERROR",
              message: "Zone code already exists in this warehouse",
            }],
          });
        }
      }

      const updated = await prisma.warehouseZone.update({
        where: { id },
        data: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
        include: {
          warehouse: true,
          bins: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE",
        entityType: "WarehouseZone",
        entityId: id,
        previousState: zone,
        newState: updated,
      });

      return { data: updated };
    },
  );

  app.delete(
    "/api/warehouse-zones/:id",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "warehouse.delete"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const zone = await prisma.warehouseZone.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          bins: true,
        },
      });

      if (!zone) {
        return reply.code(404).send({
          errors: [{ code: "NOT_FOUND", message: "Warehouse zone not found" }],
        });
      }

      if (zone.bins.length > 0) {
        return reply.code(409).send({
          errors: [{
            code: "CONFLICT",
            message: "Cannot delete a zone containing bins",
          }],
        });
      }

      await prisma.warehouseZone.delete({
        where: { id },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "DELETE",
        entityType: "WarehouseZone",
        entityId: id,
        previousState: zone,
      });

      return {
        data: {
          id,
          deleted: true,
        },
      };
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
            "warehouse.view",
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
            "warehouse.create",
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

  app.put(
    "/api/warehouse-bins/:id",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "warehouse.update"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };
      const body = request.body as {
        code?: string;
        name?: string;
        active?: boolean;
      };

      const bin = await prisma.warehouseBin.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          zone: {
            include: {
              warehouse: true,
            },
          },
        },
      });

      if (!bin) {
        return reply.code(404).send({
          errors: [{ code: "NOT_FOUND", message: "Warehouse bin not found" }],
        });
      }

      if (body.code && body.code !== bin.code) {
        const duplicate = await prisma.warehouseBin.findFirst({
          where: {
            tenantId: claims.tenantId,
            zoneId: bin.zoneId,
            code: body.code,
            NOT: { id },
          },
        });

        if (duplicate) {
          return reply.code(409).send({
            errors: [{
              code: "DUPLICATE_ERROR",
              message: "Bin code already exists in this zone",
            }],
          });
        }
      }

      const updated = await prisma.warehouseBin.update({
        where: { id },
        data: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
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
        action: "UPDATE",
        entityType: "WarehouseBin",
        entityId: id,
        previousState: bin,
        newState: updated,
      });

      return { data: updated };
    },
  );

  app.delete(
    "/api/warehouse-bins/:id",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "warehouse.delete"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const bin = await prisma.warehouseBin.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          zone: true,
        },
      });

      if (!bin) {
        return reply.code(404).send({
          errors: [{ code: "NOT_FOUND", message: "Warehouse bin not found" }],
        });
      }

      const stockReferences = await prisma.stockBalance.count({
        where: {
          tenantId: claims.tenantId,
          binId: id,
        },
      });

      if (stockReferences > 0) {
        return reply.code(409).send({
          errors: [{
            code: "CONFLICT",
            message: "Cannot delete a bin referenced by stock balances",
          }],
        });
      }

      await prisma.warehouseBin.delete({
        where: { id },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "DELETE",
        entityType: "WarehouseBin",
        entityId: id,
        previousState: bin,
      });

      return {
        data: {
          id,
          deleted: true,
        },
      };
    },
  );

}
