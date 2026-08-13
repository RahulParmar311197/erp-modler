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
import { postJournalEntry } from "../accounting/journal-service";
import { prisma } from "../../lib/prisma";

export async function accountsPayableRoutes(app: FastifyInstance) {
  // =========================================================
  // LIST VENDOR BILLS
  // =========================================================

  app.get(
    "/api/vendor-bills",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const bills = await prisma.vendorBill.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          organization: true,
          supplier: true,
          purchaseOrder: true,
          lines: {
            include: {
              item: true,
              purchaseOrderLine: true,
              goodsReceiptLine: true,
            },
          },
          payments: true,
        },
      });

      return {
        data: bills,
      };
    },
  );

  // =========================================================
  // GET VENDOR BILL
  // =========================================================

  app.get(
    "/api/vendor-bills/:id",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const bill = await prisma.vendorBill.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
        include: {
          organization: true,
          supplier: true,
          purchaseOrder: true,
          lines: {
            include: {
              item: true,
              purchaseOrderLine: true,
              goodsReceiptLine: true,
            },
          },
          payments: true,
        },
      });

      if (!bill) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Vendor bill not found",
            },
          ],
        });
      }

      return {
        data: bill,
      };
    },
  );

  // =========================================================
  // CREATE VENDOR BILL
  // =========================================================

  app.post(
    "/api/vendor-bills",
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
        organizationId?: string;
        supplierId?: string;
        purchaseOrderId?: string;
        billNumber?: string;
        billDate?: string;
        dueDate?: string;
        currency?: string;
        subtotal?: number;
        taxAmount?: number;
        totalAmount?: number;
        notes?: string;
        lines?: Array<{
          purchaseOrderLineId?: string;
          goodsReceiptLineId?: string;
          itemId?: string;
          description?: string;
          quantity?: number;
          unitPrice?: number;
          lineTotal?: number;
        }>;
      };

      const billNumber = body.billNumber?.trim();

      if (
        !body.organizationId ||
        !body.supplierId ||
        !billNumber ||
        !Array.isArray(body.lines) ||
        body.lines.length === 0
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "organizationId, supplierId, billNumber and at least one line are required",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // ORGANIZATION
      // -------------------------------------------------------

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
              message:
                "Organization does not exist or is inactive",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // SUPPLIER
      // -------------------------------------------------------

      const supplier = await prisma.supplier.findFirst({
        where: {
          id: body.supplierId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!supplier) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Supplier does not exist or is inactive",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // DUPLICATE BILL NUMBER
      // -------------------------------------------------------

      const existing = await prisma.vendorBill.findFirst({
        where: {
          tenantId: claims.tenantId,
          billNumber,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Vendor bill number already exists",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // OPTIONAL PURCHASE ORDER
      // -------------------------------------------------------

      let purchaseOrder:
        | (Awaited<
            ReturnType<typeof prisma.purchaseOrder.findFirst>
          > & {
            lines: Awaited<
              ReturnType<typeof prisma.purchaseOrderLine.findMany>
            >;
          })
        | null = null;

      if (body.purchaseOrderId) {
        purchaseOrder = await prisma.purchaseOrder.findFirst({
          where: {
            id: body.purchaseOrderId,
            tenantId: claims.tenantId,
          },
          include: {
            lines: true,
          },
        });

        if (!purchaseOrder) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Purchase order does not exist",
              },
            ],
          });
        }

        if (
          purchaseOrder.supplierId !== body.supplierId ||
          purchaseOrder.organizationId !== body.organizationId
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Purchase order supplier and organization must match the vendor bill",
              },
            ],
          });
        }
      }

      // -------------------------------------------------------
      // VALIDATE LINES
      // -------------------------------------------------------

      const lineData = [];
      let calculatedSubtotal = 0;

      for (const line of body.lines) {
        if (
          !line.itemId ||
          line.quantity === undefined ||
          line.unitPrice === undefined
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Each vendor bill line requires itemId, quantity and unitPrice",
              },
            ],
          });
        }

        if (line.quantity <= 0) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Vendor bill line quantity must be greater than zero",
              },
            ],
          });
        }

        if (line.unitPrice < 0) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Vendor bill line unit price cannot be negative",
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
                message:
                  `Item ${line.itemId} does not exist or is inactive`,
              },
            ],
          });
        }

        let purchaseOrderLineId = line.purchaseOrderLineId;

        if (purchaseOrderLineId && purchaseOrder) {
          const poLine = purchaseOrder.lines.find(
            (candidate) => candidate.id === purchaseOrderLineId,
          );

          if (!poLine) {
            return reply.code(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message:
                    "Purchase order line does not belong to the selected purchase order",
                },
              ],
            });
          }

          if (poLine.itemId !== line.itemId) {
            return reply.code(400).send({
              errors: [
                {
                  code: "VALIDATION_ERROR",
                  message:
                    "Vendor bill line item does not match purchase order line item",
                },
              ],
            });
          }
        } else if (purchaseOrder) {
          const matchingPoLine = purchaseOrder.lines.find(
            (candidate) => candidate.itemId === line.itemId,
          );

          if (matchingPoLine) {
            purchaseOrderLineId = matchingPoLine.id;
          }
        }

        const lineTotal =
          line.lineTotal !== undefined
            ? line.lineTotal
            : line.quantity * line.unitPrice;

        if (lineTotal < 0) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message:
                  "Vendor bill line total cannot be negative",
              },
            ],
          });
        }

        calculatedSubtotal += lineTotal;

        lineData.push({
          tenantId: claims.tenantId,
          purchaseOrderLineId: purchaseOrderLineId || null,
          goodsReceiptLineId: line.goodsReceiptLineId || null,
          itemId: line.itemId,
          description: line.description?.trim() || null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal,
        });
      }

      // -------------------------------------------------------
      // TOTALS
      // -------------------------------------------------------

      const subtotal =
        body.subtotal !== undefined
          ? body.subtotal
          : calculatedSubtotal;

      const taxAmount =
        body.taxAmount !== undefined
          ? body.taxAmount
          : 0;

      const totalAmount =
        body.totalAmount !== undefined
          ? body.totalAmount
          : subtotal + taxAmount;

      if (subtotal < 0 || taxAmount < 0 || totalAmount < 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Subtotal, tax amount and total amount cannot be negative",
            },
          ],
        });
      }

      // -------------------------------------------------------
      // CREATE
      // -------------------------------------------------------

      let bill;

      try {
        bill = await prisma.vendorBill.create({
          data: {
            tenantId: claims.tenantId,
            organizationId: body.organizationId,
            supplierId: body.supplierId,
            purchaseOrderId: body.purchaseOrderId || null,
            billNumber,
            status: "DRAFT",
            billDate: body.billDate
              ? new Date(body.billDate)
              : new Date(),
            dueDate: body.dueDate
              ? new Date(body.dueDate)
              : null,
            currency: body.currency?.trim() || "INR",
            subtotal,
            taxAmount,
            totalAmount,
            paidAmount: 0,
            notes: body.notes?.trim() || null,
            lines: {
              create: lineData,
            },
          },
          include: {
            organization: true,
            supplier: true,
            purchaseOrder: true,
            lines: {
              include: {
                item: true,
                purchaseOrderLine: true,
                goodsReceiptLine: true,
              },
            },
            payments: true,
          },
        });
      } catch (error) {
        /*
         * The pre-check above is useful for the normal path, but it is
         * intentionally not relied upon for concurrency safety.
         *
         * The database unique constraint on (tenantId, billNumber) is the
         * final authority when two requests race to create the same bill.
         */
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        ) {
          return reply.code(409).send({
            errors: [
              {
                code: "CONFLICT",
                message: "Vendor bill number already exists",
              },
            ],
          });
        }

        throw error;
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "VendorBill",
        entityId: bill.id,
        requestId: request.id,
        newState: bill,
      });

      return reply.code(201).send({
        data: bill,
      });
    },
  );

  // =========================================================
  // POST VENDOR BILL
  // =========================================================

  app.post(
    "/api/vendor-bills/:id/post",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.update"),
      ],
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const { id } = request.params as {
        id: string;
      };

      const bill = await prisma.vendorBill.findFirst({
        where: {
          id,
          tenantId: claims.tenantId,
        },
      });

      if (!bill) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Vendor bill not found",
            },
          ],
        });
      }

      if (bill.status !== "DRAFT") {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Only draft vendor bills can be posted",
            },
          ],
        });
      }

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: claims.tenantId,
          code: {
            in: ["2000", "5000"],
          },
          active: true,
        },
      });

      const accountsByCode = new Map(
        accounts.map((account) => [account.code, account]),
      );

      const accountsPayable = accountsByCode.get("2000");
      const costOfGoodsSold = accountsByCode.get("5000");

      if (!accountsPayable || !costOfGoodsSold) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Required GL accounts 2000 and 5000 are missing or inactive",
            },
          ],
        });
      }

      let updated;

      try {
        updated = await prisma.$transaction(async (tx) => {
          const postedCount = await tx.vendorBill.updateMany({
            where: {
              id: bill.id,
              tenantId: claims.tenantId,
              status: "DRAFT",
            },
            data: {
              status: "POSTED",
            },
          });

          if (postedCount.count !== 1) {
            throw new Error("VENDOR_BILL_ALREADY_POSTED");
          }

          const posted = await tx.vendorBill.findUniqueOrThrow({
            where: {
              id: bill.id,
            },
            include: {
              organization: true,
              supplier: true,
              purchaseOrder: true,
              lines: {
                include: {
                  item: true,
                  purchaseOrderLine: true,
                  goodsReceiptLine: true,
                },
              },
              payments: true,
            },
          });

          await postJournalEntry(tx, {
            tenantId: claims.tenantId,
            organizationId: bill.organizationId,
            entryNumber: `AP-${bill.billNumber}`,
            entryDate: bill.billDate,
            description: `Vendor bill ${bill.billNumber}`,
            sourceType: "VendorBill",
            sourceId: bill.id,
            lines: [
              {
                accountCode: "5000",
                description: `Cost of goods - ${bill.billNumber}`,
                debit: Number(bill.totalAmount),
                credit: 0,
              },
              {
                accountCode: "2000",
                description: `Accounts payable - ${bill.billNumber}`,
                debit: 0,
                credit: Number(bill.totalAmount),
              },
            ],
          });

          return posted;
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "VENDOR_BILL_ALREADY_POSTED"
        ) {
          return reply.code(400).send({
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: "Only draft vendor bills can be posted",
              },
            ],
          });
        }

        throw error;
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "POST",
        entityType: "VendorBill",
        entityId: bill.id,
        requestId: request.id,
        previousState: bill,
        newState: updated,
      });

      return {
        data: updated,
      };
    },
  );

  // LIST VENDOR PAYMENTS
  // =========================================================

  app.get(
    "/api/vendor-payments",
    {
      preHandler: [
        authenticate,
        async (request: FastifyRequest, reply: FastifyReply) =>
          requirePermission(request, reply, "user.view"),
      ],
    },
    async (request) => {
      const claims = request.user as AuthClaims;

      const payments = await prisma.vendorPayment.findMany({
        where: {
          tenantId: claims.tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          supplier: true,
          vendorBill: true,
        },
      });

      return {
        data: payments,
      };
    },
  );

  // =========================================================
  // CREATE VENDOR PAYMENT
  // =========================================================

  app.post(
    "/api/vendor-payments",
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
        supplierId?: string;
        vendorBillId?: string;
        paymentNumber?: string;
        paymentDate?: string;
        amount?: number;
        currency?: string;
        notes?: string;
      };

      const paymentNumber = body.paymentNumber?.trim();

      if (
        !body.supplierId ||
        !body.vendorBillId ||
        !paymentNumber ||
        body.amount === undefined
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "supplierId, vendorBillId, paymentNumber and amount are required",
            },
          ],
        });
      }

      const paymentAmount = body.amount;

      if (paymentAmount === undefined || paymentAmount <= 0) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Payment amount must be greater than zero",
            },
          ],
        });
      }

      const existing = await prisma.vendorPayment.findFirst({
        where: {
          tenantId: claims.tenantId,
          paymentNumber,
        },
      });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "CONFLICT",
              message: "Payment number already exists",
            },
          ],
        });
      }

      const supplier = await prisma.supplier.findFirst({
        where: {
          id: body.supplierId,
          tenantId: claims.tenantId,
          active: true,
        },
      });

      if (!supplier) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Supplier does not exist or is inactive",
            },
          ],
        });
      }

      const bill = await prisma.vendorBill.findFirst({
        where: {
          id: body.vendorBillId,
          tenantId: claims.tenantId,
        },
      });

      if (!bill) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Vendor bill does not exist",
            },
          ],
        });
      }

      if (bill.supplierId !== body.supplierId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Payment supplier does not match vendor bill supplier",
            },
          ],
        });
      }

      if (
        bill.status === "DRAFT" ||
        bill.status === "CANCELLED"
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Payments can only be made against posted vendor bills",
            },
          ],
        });
      }

      const remaining = bill.totalAmount.minus(bill.paidAmount);

      if (remaining.lte(0)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "Vendor bill is already fully paid",
            },
          ],
        });
      }

      if (paymentAmount > Number(remaining)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Payment amount cannot exceed outstanding vendor bill amount",
            },
          ],
        });
      }

      const payment = await prisma.$transaction(async (tx) => {
        /*
         * Atomically reserve this payment against the bill balance.
         *
         * The predicate is intentionally based on the requested payment:
         *
         *   paidAmount + paymentAmount <= totalAmount
         *
         * which is equivalent to:
         *
         *   paidAmount <= totalAmount - paymentAmount
         *
         * PostgreSQL serializes UPDATEs against the same VendorBill row.
         * Therefore, if two payments race for the final balance, the first
         * one updates the row and the second one re-evaluates this predicate
         * against the newly committed paidAmount and affects zero rows.
         */
        const maximumPaidAmount = bill.totalAmount.minus(paymentAmount);

        const updatedBill = await tx.vendorBill.updateMany({
          where: {
            id: bill.id,
            tenantId: claims.tenantId,
            status: {
              in: ["POSTED", "PARTIALLY_PAID"],
            },
            paidAmount: {
              lte: maximumPaidAmount,
            },
          },
          data: {
            paidAmount: {
              increment: paymentAmount,
            },
          },
        });

        if (updatedBill.count !== 1) {
          return null;
        }

        const lockedBill = await tx.vendorBill.findUniqueOrThrow({
          where: {
            id: bill.id,
          },
        });

        const newStatus = lockedBill.paidAmount.gte(
          lockedBill.totalAmount,
        )
          ? "PAID"
          : "PARTIALLY_PAID";

        const created = await tx.vendorPayment.create({
          data: {
            tenantId: claims.tenantId,
            supplierId: body.supplierId!,
            vendorBillId: body.vendorBillId!,
            paymentNumber,
            paymentDate: body.paymentDate
              ? new Date(body.paymentDate)
              : new Date(),
            amount: paymentAmount,
            currency: body.currency?.trim() || bill.currency,
            notes: body.notes?.trim() || null,
          },
          include: {
            supplier: true,
            vendorBill: true,
          },
        });

        await postJournalEntry(tx, {
          tenantId: claims.tenantId,
          organizationId: bill.organizationId,
          entryNumber: `AP-PAY-${paymentNumber}`,
          entryDate: created.paymentDate,
          description: `Vendor payment ${paymentNumber}`,
          sourceType: "VendorPayment",
          sourceId: created.id,
          lines: [
            {
              accountCode: "2000",
              description: `Accounts payable - ${paymentNumber}`,
              debit: paymentAmount,
              credit: 0,
            },
            {
              accountCode: "1000",
              description: `Cash / Bank - ${paymentNumber}`,
              debit: 0,
              credit: paymentAmount,
            },
          ],
        });

        await tx.vendorBill.update({
          where: {
            id: bill.id,
          },
          data: {
            status: newStatus,
          },
        });

        return created;
      });

      if (!payment) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "Payment amount cannot exceed outstanding vendor bill amount",
            },
          ],
        });
      }

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "CREATE",
        entityType: "VendorPayment",
        entityId: payment.id,
        requestId: request.id,
        newState: payment,
      });

      return reply.code(201).send({
        data: payment,
      });
    },
  );
}
