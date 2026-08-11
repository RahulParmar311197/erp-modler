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

export async function itemRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  // =========================================================
  // ITEM GROUPS
  // =========================================================

  app.get(
    "/api/item-groups",
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

      const groups = await prisma.itemGroup.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          code: "asc",
        },
        include: {
          items: true,
        },
      });

      return {
        data: groups,
      };
    },
  );

  app.post(
    "/api/item-groups",
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
        code?: string;
        name?: string;
      };

      if (!body.code || !body.name) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "code and name are required",
            },
          ],
        });
      }

      const existing =
        await prisma.itemGroup.findFirst({
          where: {
            tenantId: claims.tenantId,
            code: body.code,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message: "Item group code already exists",
            },
          ],
        });
      }

      const group = await prisma.itemGroup.create({
        data: {
          tenantId: claims.tenantId,
          code: body.code,
          name: body.name,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "ItemGroup",
        entityId: group.id,
        newState: group,
      });

      return reply.code(201).send({
        data: group,
      });
    },
  );

  // =========================================================
  // UNITS OF MEASURE
  // =========================================================

  app.get(
    "/api/units-of-measure",
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

      const units =
        await prisma.unitOfMeasure.findMany({
          where: {
            tenantId: claims.tenantId,
          },
          orderBy: {
            code: "asc",
          },
          include: {
            items: true,
          },
        });

      return {
        data: units,
      };
    },
  );

  app.post(
    "/api/units-of-measure",
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
        code?: string;
        name?: string;
        symbol?: string;
      };

      if (!body.code || !body.name) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "code and name are required",
            },
          ],
        });
      }

      const existing =
        await prisma.unitOfMeasure.findFirst({
          where: {
            tenantId: claims.tenantId,
            code: body.code,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message:
                "Unit of measure code already exists",
            },
          ],
        });
      }

      const unit =
        await prisma.unitOfMeasure.create({
          data: {
            tenantId: claims.tenantId,
            code: body.code,
            name: body.name,
            symbol: body.symbol,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "UnitOfMeasure",
        entityId: unit.id,
        newState: unit,
      });

      return reply.code(201).send({
        data: unit,
      });
    },
  );

  // =========================================================
  // ITEMS
  // =========================================================

  app.get(
    "/api/items",
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

      const items = await prisma.item.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          sku: "asc",
        },
        include: {
          itemGroup: true,
          baseUom: true,
        },
      });

      return {
        data: items,
      };
    },
  );

  app.post(
    "/api/items",
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
        sku?: string;
        name?: string;
        description?: string;
        itemGroupId?: string;
        baseUomId?: string;
        itemType?: string;
        trackInventory?: boolean;
      };

      if (
        !body.sku ||
        !body.name ||
        !body.baseUomId
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "sku, name and baseUomId are required",
            },
          ],
        });
      }

      const existing =
        await prisma.item.findFirst({
          where: {
            tenantId: claims.tenantId,
            sku: body.sku,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ERROR",
              message: "Item SKU already exists",
            },
          ],
        });
      }

      const uom =
        await prisma.unitOfMeasure.findFirst({
          where: {
            id: body.baseUomId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

      if (!uom) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Base unit of measure does not exist or is inactive",
            },
          ],
        });
      }

      if (body.itemGroupId) {
        const group =
          await prisma.itemGroup.findFirst({
            where: {
              id: body.itemGroupId,
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
                  "Item group does not exist or is inactive",
              },
            ],
          });
        }
      }

      const item = await prisma.item.create({
        data: {
          tenantId: claims.tenantId,
          sku: body.sku,
          name: body.name,
          description: body.description,
          itemGroupId: body.itemGroupId,
          baseUomId: body.baseUomId,
          itemType: body.itemType ?? "STOCK",
          trackInventory:
            body.trackInventory ?? true,
        },
        include: {
          itemGroup: true,
          baseUom: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "Item",
        entityId: item.id,
        newState: item,
      });

      return reply.code(201).send({
        data: item,
      });
    },
  );
}
