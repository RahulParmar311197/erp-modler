import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

console.log("Seed accounts environment:", envPath);
console.log("Database configured:", Boolean(process.env.DATABASE_URL));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(`DATABASE_URL not found. Expected: ${envPath}`);
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Testing database connection for COA seed...");
  await pool.query("SELECT 1");
  console.log("Connected.");

  // Find the demo tenant created by the main seed
  const tenant = await prisma.tenant.findFirst({ where: { code: "MODLER" } });
  if (!tenant) {
    throw new Error("Tenant MODLER not found. Run packages/database/prisma/seed.ts first.");
  }

  // Simple Chart of Accounts
  // Create Account Groups
  const glGroups = [
    { code: "100", name: "Assets", nature: "ASSET" },
    { code: "200", name: "Liabilities", nature: "LIABILITY" },
    { code: "300", name: "Equity", nature: "EQUITY" },
    { code: "400", name: "Revenue", nature: "REVENUE" },
    { code: "500", name: "Expenses", nature: "EXPENSE" },
  ];

  for (const g of glGroups) {
    await prisma.glAccountGroup.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: g.code } },
      update: { name: g.name, nature: g.nature },
      create: { tenantId: tenant.id, code: g.code, name: g.name, nature: g.nature, systemDefined: false },
    });
  }

  // Create a handful of GL accounts useful for testing
  const accounts = [
    { code: "1000", name: "Cash", type: "ASSET", groupCode: "100" },
    { code: "1010", name: "Bank", type: "ASSET", groupCode: "100" },
    { code: "1100", name: "Accounts Receivable", type: "ASSET", groupCode: "100" },
    { code: "2000", name: "Accounts Payable", type: "LIABILITY", groupCode: "200" },
    { code: "3000", name: "Capital", type: "EQUITY", groupCode: "300" },
    { code: "4000", name: "Sales", type: "REVENUE", groupCode: "400" },
    { code: "5000", name: "Cost of Goods Sold", type: "EXPENSE", groupCode: "500" },
  ];

  // Map group codes to group ids
  const groups = await prisma.glAccountGroup.findMany({ where: { tenantId: tenant.id } });
  const groupMap = new Map(groups.map((g) => [g.code, g]));

  for (const a of accounts) {
    const group = groupMap.get(a.groupCode);
    await prisma.glAccount.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: a.code } },
      update: { name: a.name, type: a.type },
      create: {
        tenantId: tenant.id,
        organizationId: undefined,
        groupId: group ? group.id : undefined,
        code: a.code,
        name: a.name,
        type: a.type,
        active: true,
      },
    });
  }

  console.log("COA seed completed for tenant:", tenant.code);
}

main()
  .catch((err) => {
    console.error("COA seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
