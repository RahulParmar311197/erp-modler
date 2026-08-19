import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

console.log("Seed environment:", envPath);
console.log("Database configured:", Boolean(process.env.DATABASE_URL));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";
import argon2 from "argon2";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(`DATABASE_URL not found. Expected: ${envPath}`);
}

const pool = new Pool({
  connectionString: databaseUrl,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Testing database connection...");

  await pool.query("SELECT 1");

  console.log("Database connection successful.");
  console.log("Seeding ERP MODLER...");

  const tenant = await prisma.tenant.upsert({
    where: {
      code: "MODLER",
    },
    update: {
      name: "ERP MODLER Demo",
      status: "ACTIVE",
    },
    create: {
      code: "MODLER",
      name: "ERP MODLER Demo",
      status: "ACTIVE",
      defaultCurrency: "INR",
      timezone: "Asia/Kolkata",
    },
  });

  const organization = await prisma.organization.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "MODLER-IN",
      },
    },
    update: {
      name: "MODLER India",
      active: true,
    },
    create: {
      tenantId: tenant.id,
      code: "MODLER-IN",
      name: "MODLER India",
      type: "LEGAL_ENTITY",
    },
  });

  /*
   * Accounting foundation
   */
  const fiscalYear = await prisma.fiscalYear.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "FY2026",
      },
    },
    update: {
      name: "Financial Year 2026",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2027-03-31T00:00:00.000Z"),
      status: "OPEN",
    },
    create: {
      tenantId: tenant.id,
      code: "FY2026",
      name: "Financial Year 2026",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2027-03-31T00:00:00.000Z"),
      status: "OPEN",
    },
  });

  await prisma.accountingPeriod.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "FY2026-P05",
      },
    },
    update: {
      fiscalYearId: fiscalYear.id,
      name: "August 2026",
      periodNumber: 5,
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      status: "OPEN",
    },
    create: {
      tenantId: tenant.id,
      fiscalYearId: fiscalYear.id,
      code: "FY2026-P05",
      name: "August 2026",
      periodNumber: 5,
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      status: "OPEN",
    },
  });

  const voucherTypes = [
    ["JOURNAL", "Journal Voucher", "JOURNAL", "JV-"],
    ["RECEIPT", "Receipt Voucher", "RECEIPT", "RV-"],
    ["PAYMENT", "Payment Voucher", "PAYMENT", "PV-"],
    ["SALES", "Sales Voucher", "SALES", "SV-"],
    ["PURCHASE", "Purchase Voucher", "PURCHASE", "PUR-"],
    ["CONTRA", "Contra Voucher", "CONTRA", "CV-"],
  ] as const;

  for (const [code, name, voucherType, prefix] of voucherTypes) {
    await prisma.voucherType.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code,
        },
      },
      update: {
        name,
        voucherType,
        prefix,
        numberPadding: 6,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        code,
        name,
        voucherType,
        prefix,
        numberPadding: 6,
        nextNumber: 1,
        active: true,
      },
    });
  }

  const permissionCodes = [
    "tenant.view",
    "tenant.update",
    "organization.view",
    "organization.create",
    "organization.update",
    "organization.delete",
    "location.view",
    "location.create",
    "location.update",
    "location.delete",
    "warehouse.view",
    "warehouse.create",
    "warehouse.update",
    "warehouse.delete",
    "stock.view",
    "stock.update",

    "user.view",
    "user.create",
    "user.update",
    "user.disable",
    "role.view",
    "role.create",
    "role.update",
    "role.delete",
    "role.manage",
    "permission.view",
  ];

  const permissions = [];

  for (const code of permissionCodes) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        description: `ERP MODLER permission: ${code}`,
      },
    });

    permissions.push(permission);
  }

  const role = await prisma.role.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "SUPER_ADMIN",
      },
    },
    update: {
      name: "Super Administrator",
    },
    create: {
      tenantId: tenant.id,
      code: "SUPER_ADMIN",
      name: "Super Administrator",
    },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
  }

  const passwordHash = await argon2.hash("ModlerAdmin@2026!");

  const user = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: "admin@modler.local",
      },
    },
    update: {
      name: "System Administrator",
      organizationId: organization.id,
      status: "ACTIVE",
      passwordHash,
    },
    create: {
      tenantId: tenant.id,
      organizationId: organization.id,
      email: "admin@modler.local",
      name: "System Administrator",
      passwordHash,
      status: "ACTIVE",
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  });

  console.log("");
  console.log("========================================");
  console.log("ERP MODLER SEED COMPLETED");
  console.log("========================================");
  console.log(`Tenant:       ${tenant.code}`);
  console.log(`Organization: ${organization.code}`);
  console.log(`Admin:        ${user.email}`);
  console.log(`Role:         ${role.code}`);
  console.log("");
  console.log("Development login:");
  console.log("Email:        admin@modler.local");
  console.log("Password:     ModlerAdmin@2026!");
  console.log("========================================");
}

main()
  .catch((error) => {
    console.error("Seed failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
