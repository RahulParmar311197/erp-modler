import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import argon2 from "argon2";

import { prisma } from "./lib/prisma";

import {
  AuthClaims,
  authenticate,
} from "./auth/authorization";

import { organizationRoutes } from "./modules/organizations/routes";
import { locationRoutes } from "./modules/locations/routes";
import { warehouseRoutes } from "./modules/warehouses/routes";
import { warehouseStorageRoutes } from "./modules/warehouse-storage/routes";
import { itemRoutes } from "./modules/items/routes";
import { stockRoutes } from "./modules/stock/routes";
import { supplierRoutes } from "./modules/purchasing/routes";
import { purchaseOrderRoutes } from "./modules/purchasing/purchase-orders";
import { goodsReceiptRoutes } from "./modules/receiving/routes";
import { userRoutes } from "./modules/users/routes";
import { roleRoutes } from "./modules/roles/routes";
import { ApiError, errorResponse } from "./lib/errors";
import { registerRequestId } from "./lib/request-id";
import { customerRoutes, salesOrderRoutes } from "./modules/sales/routes";
import { shipmentRoutes } from "./modules/sales/shipment-routes";
import { salesInvoiceRoutes } from "./modules/sales/invoice-routes";
import { accountsPayableRoutes } from "./modules/accounts-payable/routes";
import { accountingRoutes } from "./modules/accounting/routes";
import { journalRoutes } from "./modules/accounting/journal-routes";
import { voucherRoutes } from "./modules/accounting/voucher-routes";
import { periodRoutes } from "./modules/accounting/period-routes";

export async function buildApp() {
  const authSecret = process.env.AUTH_SECRET;

  if (!authSecret) {
    throw new Error("AUTH_SECRET is not configured");
  }

  const app = Fastify({
    logger: true,
  });

  registerRequestId(app);

  app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.register(helmet, {
    global: true,
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof ApiError) {
      return reply
        .code(error.statusCode)
        .send(
          errorResponse(
            error.code,
            error.message,
            error.details,
          ),
        );
    }

    return reply.code(500).send(
      errorResponse(
        "INTERNAL_SERVER_ERROR",
        "An unexpected error occurred",
      ),
    );
  });

  app.register(jwt, {
    secret: authSecret,
  });

  /**
   * Health check
   */
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      service: "erp-modler-api",
      database: "connected",
    };
  });

  /**
   * Tenant listing
   */
  app.get("/api/tenants", async () => {
    const tenants = await prisma.tenant.findMany({
      orderBy: {
        name: "asc",
      },
    });

    return {
      data: tenants,
    };
  });

  /**
   * Login
   */
  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as {
      tenantCode?: string;
      email?: string;
      password?: string;
    };

    if (!body.tenantCode || !body.email || !body.password) {
      return reply.code(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message:
              "tenantCode, email and password are required",
          },
        ],
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: body.email,
        tenant: {
          code: body.tenantCode,
        },
      },
      include: {
        tenant: true,
        organization: true,
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      return reply.code(401).send({
        errors: [
          {
            code: "AUTHENTICATION_ERROR",
            message: "Invalid credentials",
          },
        ],
      });
    }

    const passwordValid = await argon2.verify(
      user.passwordHash,
      body.password,
    );

    if (!passwordValid) {
      return reply.code(401).send({
        errors: [
          {
            code: "AUTHENTICATION_ERROR",
            message: "Invalid credentials",
          },
        ],
      });
    }

    const permissions = [
      ...new Set(
        user.roles.flatMap((userRole) =>
          userRole.role.permissions.map(
            (rolePermission) =>
              rolePermission.permission.code,
          ),
        ),
      ),
    ];

    const roles = user.roles.map(
      (userRole) => userRole.role.code,
    );

    const token = await app.jwt.sign({
      sub: user.id,
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      roles,
      permissions,
    });

    return {
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: "8h",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        tenant: {
          id: user.tenant.id,
          code: user.tenant.code,
          name: user.tenant.name,
        },
        organization: user.organization
          ? {
              id: user.organization.id,
              code: user.organization.code,
              name: user.organization.name,
            }
          : null,
        roles,
        permissions,
      },
    };
  });

  /**
   * Current authenticated user
   */
  app.get(
    "/api/me",
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const claims = request.user as AuthClaims;

      const user = await prisma.user.findFirst({
        where: {
          id: claims.sub,
          tenantId: claims.tenantId,
        },
        include: {
          tenant: true,
          organization: true,
          roles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "User not found",
            },
          ],
        });
      }

      const permissions = [
        ...new Set(
          user.roles.flatMap((userRole) =>
            userRole.role.permissions.map(
              (rolePermission) =>
                rolePermission.permission.code,
            ),
          ),
        ),
      ];

      return {
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
          tenant: {
            id: user.tenant.id,
            code: user.tenant.code,
            name: user.tenant.name,
          },
          organization: user.organization
            ? {
                id: user.organization.id,
                code: user.organization.code,
                name: user.organization.name,
              }
            : null,
          roles: user.roles.map(
            (userRole) => userRole.role.code,
          ),
          permissions,
        },
      };
    },
  );

  /**
   * Register modules
   */
  app.register(async (instance) => {
    await organizationRoutes(instance, prisma);
    await userRoutes(instance, prisma);
    await roleRoutes(instance, prisma);
    await locationRoutes(instance, prisma);
    await warehouseRoutes(instance, prisma);
    await warehouseStorageRoutes(instance, prisma);
    await itemRoutes(instance, prisma);
    await stockRoutes(instance, prisma);
    await supplierRoutes(instance);
    await purchaseOrderRoutes(instance);
    await customerRoutes(instance, prisma);
    await salesOrderRoutes(instance, prisma);
    await shipmentRoutes(instance, prisma);
    await salesInvoiceRoutes(instance, prisma);
    await goodsReceiptRoutes(instance);
    await accountsPayableRoutes(instance);
    await accountingRoutes(instance, prisma);
    await journalRoutes(instance, prisma);
    await voucherRoutes(instance, prisma);
    await periodRoutes(instance, prisma);
  });

  return app;
}
