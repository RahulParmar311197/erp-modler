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

export async function customerRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get(
    "/api/customers",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const customers = await prisma.customer.findMany({
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

      return { data: customers };
    },
  );

  app.post(
    "/api/customers",
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
        organizationId?: string;
        email?: string;
        phone?: string;
        taxNumber?: string;
        paymentTerms?: string;
        currency?: string;
      };

      const code = body.code?.trim();
      const name = body.name?.trim();

      if (!code || !name) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "code and name are required",
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

      const existing = await prisma.customer.findFirst({
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
              message: "Customer code already exists",
            },
          ],
        });
      }

      const customer = await prisma.customer.create({
        data: {
          tenantId: claims.tenantId,
          organizationId: body.organizationId ?? null,
          code,
          name,
          email: body.email?.trim() || null,
          phone: body.phone?.trim() || null,
          taxNumber: body.taxNumber?.trim() || null,
          paymentTerms: body.paymentTerms?.trim() || null,
          currency: body.currency?.trim() || "INR",
        },
        include: {
          organization: true,
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "Customer",
        entityId: customer.id,
        newState: customer,
      });

      return reply.code(201).send({ data: customer });
    },
  );
}

export async function salesOrderRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get(
    "/api/sales-orders",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const orders = await prisma.salesOrder.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          customer: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

      return { data: orders };
    },
  );

  app.get(
    "/api/sales-orders/:id",
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

      const order = await prisma.salesOrder.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          customer: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Sales order not found",
            },
          ],
        });
      }

      return { data: order };
    },
  );

  app.post(
    "/api/sales-orders",
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
        orderNumber?: string;
        organizationId?: string;
        customerId?: string;
        requestedDate?: string;
        currency?: string;
        notes?: string;
        lines?: Array<{
          itemId?: string;
          uomId?: string;
          quantity?: number;
          unitPrice?: number;
        }>;
      };

      const orderNumber = body.orderNumber?.trim();

      if (!orderNumber || !body.organizationId || !body.customerId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "orderNumber, organizationId and customerId are required",
            },
          ],
        });
      }

      if (!body.lines?.length) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "At least one sales order line is required",
            },
          ],
        });
      }

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

      const customer = await prisma.customer.findFirst({
        where: {
          id: body.customerId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!customer) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Customer does not exist or is inactive",
            },
          ],
        });
      }

      const existing = await prisma.salesOrder.findFirst({
        where: {
          tenantId: claims.tenantId,
          orderNumber,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Sales order number already exists",
            },
          ],
        });
      }

      for (const line of body.lines) {
        if (
          !line.itemId ||
          !line.uomId ||
          line.quantity === undefined ||
          line.quantity <= 0 ||
          line.unitPrice === undefined ||
          line.unitPrice < 0
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Each line requires itemId, uomId, positive quantity and non-negative unitPrice",
              },
            ],
          });
        }

        const item = await prisma.item.findFirst({
          where: {
            id: line.itemId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

        if (!item) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Item does not exist or is inactive",
              },
            ],
          });
        }

        const uom = await prisma.unitOfMeasure.findFirst({
          where: {
            id: line.uomId,
            tenantId: claims.tenantId,
            active: true,
          },
        });

        if (!uom) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "UOM does not exist or is inactive",
              },
            ],
          });
        }
      }

      const order = await prisma.salesOrder.create({
        data: {
          tenantId: claims.tenantId,
          organizationId: body.organizationId,
          customerId: body.customerId,
          orderNumber,
          requestedDate: body.requestedDate
            ? new Date(body.requestedDate)
            : null,
          currency: body.currency?.trim() || "INR",
          notes: body.notes?.trim() || null,
          lines: {
            create: body.lines.map((line) => ({
              itemId: line.itemId!,
              uomId: line.uomId!,
              quantity: line.quantity!,
              unitPrice: line.unitPrice!,
            })),
          },
        },
        include: {
          customer: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "SalesOrder",
        entityId: order.id,
        newState: order,
      });

      return reply.code(201).send({ data: order });
    },
  );

  app.post(
    "/api/sales-orders/:id/submit",
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

      const order = await prisma.salesOrder.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
      });

      if (!order) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Sales order not found",
            },
          ],
        });
      }

      if (order.status !== "DRAFT") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only DRAFT sales orders can be submitted",
            },
          ],
        });
      }

      const submitted = await prisma.salesOrder.updateMany({
        where: {
          id: order.id,
          tenantId: claims.tenantId,
          status: "DRAFT",
        },
        data: {
          status: "SUBMITTED",
        },
      });

      if (submitted.count !== 1) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only DRAFT sales orders can be submitted",
            },
          ],
        });
      }

      const updated = await prisma.salesOrder.findUniqueOrThrow({
        where: {
          id: order.id,
        },
        include: {
          customer: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "SUBMIT",
        entityType: "SalesOrder",
        entityId: updated.id,
        previousState: order,
        newState: updated,
      });

      return { data: updated };
    },
  );

  app.post(
    "/api/sales-orders/:id/approve",
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

      const order = await prisma.salesOrder.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
      });

      if (!order) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Sales order not found",
            },
          ],
        });
      }

      if (order.status !== "SUBMITTED") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only SUBMITTED sales orders can be approved",
            },
          ],
        });
      }

      const approved = await prisma.salesOrder.updateMany({
        where: {
          id: order.id,
          tenantId: claims.tenantId,
          status: "SUBMITTED",
        },
        data: {
          status: "APPROVED",
        },
      });

      if (approved.count !== 1) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only SUBMITTED sales orders can be approved",
            },
          ],
        });
      }

      const updated = await prisma.salesOrder.findUniqueOrThrow({
        where: {
          id: order.id,
        },
        include: {
          customer: true,
          organization: true,
          lines: {
            include: {
              item: true,
              uom: true,
            },
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "APPROVE",
        entityType: "SalesOrder",
        entityId: updated.id,
        previousState: order,
        newState: updated,
      });

      return { data: updated };
    },
  );
}
