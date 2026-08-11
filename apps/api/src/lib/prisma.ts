import dotenv from "dotenv";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
} from "../../../../packages/database/generated/prisma/client";
import { Pool } from "pg";

dotenv.config({
  path: path.resolve(__dirname, "../../../../.env"),
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not configured"
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
});
