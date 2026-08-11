import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

describe("API application", () => {
  it("responds to the health check", async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toMatchObject({
        status: "ok",
        service: "erp-modler-api",
        database: "connected",
      });
    } finally {
      await app.close();
    }
  });

  it("protects sales endpoints", async () => {
    const app = await buildApp();

    try {
      const endpoints = [
        "/api/sales-orders",
        "/api/shipments",
        "/api/sales-invoices",
      ];

      for (const url of endpoints) {
        const response = await app.inject({
          method: "GET",
          url,
        });

        expect(response.statusCode).toBe(401);
      }
    } finally {
      await app.close();
    }
  });
});
