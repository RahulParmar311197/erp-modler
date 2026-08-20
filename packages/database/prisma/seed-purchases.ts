import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

console.log("Seed purchases environment:", envPath);
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
  console.log("Testing DB connection for purchases seed...");
  await pool.query("SELECT 1");

  const tenant = await prisma.tenant.findFirst({ where: { code: "MODLER" } });
  if (!tenant) throw new Error("Tenant MODLER not found. Run main seed first.");

  // Supplier
  const supplier = await prisma.supplier.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "SUP-001" } },
    update: { name: "Default Supplier", active: true },
    create: { tenantId: tenant.id, code: "SUP-001", name: "Default Supplier", currency: "INR" },
  });

  // UoM
  const uom = await prisma.unitOfMeasure.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: "NOS" } }, update: { name: "Nos" }, create: { tenantId: tenant.id, code: "NOS", name: "Nos", symbol: "nos" } });

  // Inventory account (1200)
  await prisma.glAccount.upsert({ where: { tenantId_code: { tenantId: tenant.id, code: "1200" } }, update: { name: "Inventory", type: "ASSET" }, create: { tenantId: tenant.id, code: "1200", name: "Inventory", type: "ASSET", active: true } });

  // Sample item
  const item = await prisma.item.upsert({ where: { tenantId_sku: { tenantId: tenant.id, sku: "ITEM-001" } }, update: { name: "Sample Item" }, create: { tenantId: tenant.id, sku: "ITEM-001", name: "Sample Item", baseUomId: uom.id } });

  console.log("Purchases seed completed:", { tenant: tenant.code, supplier: supplier.code, item: item.sku });
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
