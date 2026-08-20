import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, requirePermission, AuthClaims } from "../../auth/authorization";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type SOLineInput = {
  itemId?: string;
  uomId?: string;
  quantity?: number;
  unitPrice?: number;
};

export async function salesOrderRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.post(
    "/api/sales/orders",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.create")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const body = request.body as {
        organizationId?: string;
        customerId?: string;
        orderDate?: string;
        currency?: string;
        notes?: string;
        lines?: SOLineInput[];
      };

      if (!body.organizationId || !body.customerId) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "organizationId and customerId are required" }] });
      }

      const lines = body.lines ?? [];
      if (lines.length < 1) {
        return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "At least one order line is required" }] });
      }

      for (const line of lines) {
        if (!line.itemId || !line.uomId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
          return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Each line requires itemId, uomId and positive quantity" }] });
        }
      }

      const [organization, customer] = await Promise.all([
        prisma.organization.findFirst({ where: { id: body.organizationId, tenantId: claims.tenantId, active: true } }),
        prisma.customer.findFirst({ where: { id: body.customerId, tenantId: claims.tenantId, active: true } }),
      ]);

      if (!organization) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Organization not found or inactive" }] });
      if (!customer) return reply.code(400).send({ errors: [{ code: "VALIDATION_ERROR", message: "Customer not found or inactive" }] });

      const so = await prisma.$transaction(async (tx) => {
        const orderNumber = `SO-${Date.now()}`;
        const created = await tx.salesOrder.create({ data: { tenantId: claims.tenantId, organizationId: organization.id, customerId: customer.id, orderNumber, orderDate: body.orderDate ? new Date(`${body.orderDate}T00:00:00.000Z`) : new Date(), currency: body.currency ?? customer.currency ?? "INR", notes: body.notes ?? null } });

        await Promise.all(lines.map((line) => tx.salesOrderLine.create({ data: { salesOrderId: created.id, itemId: line.itemId!, uomId: line.uomId!, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice ?? 0) } } )));

        return tx.salesOrder.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
      });

      return reply.code(201).send({ data: so });
    },
  );

  app.get(
    "/api/sales/orders/:id",
    {
      preHandler: [authenticate, async (request: FastifyRequest, reply: FastifyReply) => requirePermission(request, reply, "user.view")],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;
      const { id } = request.params as { id: string };

      const so = await prisma.salesOrder.findFirst({ where: { id, tenantId: claims.tenantId }, include: { lines: { include: { item: true, uom: true } }, customer: true, organization: true } });
      if (!so) return reply.code(404).send({ errors: [{ code: "NOT_FOUND", message: "Sales order not found" }] });
      return { data: so };
    },
  );
}
