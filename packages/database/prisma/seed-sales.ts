import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

console.log("Seed sales environment:", envPath);
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
  console.log("Testing DB connection for sales seed...");
  await pool.query("SELECT 1");

  const tenant = await prisma.tenant.findFirst({ where: { code: "MODLER" } });
  if (!tenant) throw new Error("Tenant MODLER not found. Run main seed first.");

  // Customer
  const customer = await prisma.customer.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "CUST-001" } },
    update: { name: "Default Customer", active: true },
    create: { tenantId: tenant.id, code: "CUST-001", name: "Default Customer", currency: "INR" },
  });

  // Bank account (1010) and GL mapping
  // Ensure GL accounts exist
  await prisma.glAccount.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: "1010" } }, update: { name: "Bank", type: "ASSET" }, create: { tenantId: tenant.id, code: "1010", name: "Bank", type: "ASSET", active: true } });
  await prisma.bankAccount.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: "BANK-001" } }, update: { name: "Default Bank" }, create: { tenantId: tenant.id, organizationId: undefined, glAccountId: (await prisma.glAccount.findFirst({ where: { tenantId: tenant.id, code: "1010" } }))!.id, code: "BANK-001", name: "Default Bank", accountNumber: "0001", currency: "INR" } });

  console.log("Sales seed completed:", { tenant: tenant.code, customer: customer.code });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
