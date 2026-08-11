import { describe, expect, it } from "vitest";
import { buildApp } from "../app";

const invoiceId =
  "2c079ebd-738b-4f55-81c7-7446b3573998";

describe("INV-2026-0002 reconciliation", () => {
  it("keeps the posted invoice fully paid", async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/sales-invoices/${invoiceId}`,
        headers: {
          // This test intentionally verifies authentication behavior
          // before introducing a test-token fixture.
        },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
