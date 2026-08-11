import dotenv from "dotenv";

import { buildApp } from "./app";
import { prisma, pool } from "./lib/prisma";

dotenv.config({
  path: "../../.env",
});

const start = async () => {
  const app = await buildApp();

  try {
    await prisma.$connect();

    await app.listen({
      host: "0.0.0.0",
      port: Number(process.env.PORT ?? 3001),
    });

    console.log("ERP MODLER API running");
  } catch (error) {
    app.log.error(error);

    await prisma.$disconnect();
    await pool.end();

    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);

    try {
      await app.close();
      await prisma.$disconnect();
      await pool.end();

      app.log.info("ERP MODLER API shutdown complete");
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
};

void start();
