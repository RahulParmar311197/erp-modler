import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../lib/prisma";

const organizationId =
  "0acbfc53-94fe-457c-8e43-b048dc454a3d";

describe("Accounting GL workflows", () => {
  it("creates, posts, reverses, and protects a journal entry", async () => {
    const app = await buildApp();

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          tenantCode: "MODLER",
          email: "admin@modler.local",
          password: "ModlerAdmin@2026!",
        },
      });

      expect(login.statusCode).toBe(200);

      const headers = {
        authorization: `Bearer ${login.json().data.token}`,
      };

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: {
          code: "MODLER",
        },
      });

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: tenant.id,
          code: {
            in: ["1000", "4000"],
          },
          active: true,
        },
      });

      const cash = accounts.find((account) => account.code === "1000");
      const revenue = accounts.find((account) => account.code === "4000");

      expect(cash).toBeDefined();
      expect(revenue).toBeDefined();

      const suffix = Date.now();

      // 1. Create a balanced DRAFT journal entry.
      const create = await app.inject({
        method: "POST",
        url: "/api/gl/journal-entries",
        headers,
        payload: {
          organizationId,
          entryNumber: `JE-TEST-${suffix}`,
          entryDate: "2026-08-12",
          description: `Accounting integration test ${suffix}`,
          sourceType: "AccountingTest",
          sourceId: `ACCOUNTING-TEST-${suffix}`,
          status: "DRAFT",
          lines: [
            {
              accountId: cash!.id,
              debit: 125,
              credit: 0,
              description: "Test cash",
            },
            {
              accountId: revenue!.id,
              debit: 0,
              credit: 125,
              description: "Test revenue",
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const created = create.json().data;

      expect(created.status).toBe("DRAFT");
      expect(created.lines).toHaveLength(2);

      // 2. Post the balanced entry.
      const post = await app.inject({
        method: "POST",
        url: `/api/gl/journal-entries/${created.id}/post`,
        headers,
      });

      expect(post.statusCode).toBe(200);
      expect(post.json().data.status).toBe("POSTED");

      // 3. Verify it can be found by sourceType/sourceId.
      const filtered = await app.inject({
        method: "GET",
        url: `/api/gl/journal-entries?sourceType=AccountingTest&sourceId=ACCOUNTING-TEST-${suffix}&page=1&pageSize=10`,
        headers,
      });

      expect(filtered.statusCode).toBe(200);

      const filteredData = filtered.json();

      expect(filteredData.data).toHaveLength(1);
      expect(filteredData.data[0].id).toBe(created.id);
      expect(filteredData.meta.totalCount).toBe(1);
      expect(filteredData.meta.totals.debit).toBe(125);
      expect(filteredData.meta.totals.credit).toBe(125);
      expect(filteredData.meta.totals.balance).toBe(0);

      // 4. Reverse the posted entry.
      const reverse = await app.inject({
        method: "POST",
        url: `/api/gl/journal-entries/${created.id}/reverse`,
        headers,
      });

      expect(reverse.statusCode).toBe(201);

      const reversal = reverse.json().data;

      expect(reversal.status).toBe("POSTED");
      expect(reversal.sourceType).toBe("JournalEntryReversal");
      expect(reversal.sourceId).toBe(created.id);
      expect(reversal.lines).toHaveLength(2);

      expect(reversal.lines[0].debit).toBe("0");
      expect(reversal.lines[0].credit).toBe("125");
      expect(reversal.lines[1].debit).toBe("125");
      expect(reversal.lines[1].credit).toBe("0");

      // 5. A second reversal must be rejected.
      const duplicateReverse = await app.inject({
        method: "POST",
        url: `/api/gl/journal-entries/${created.id}/reverse`,
        headers,
      });

      expect(duplicateReverse.statusCode).toBe(409);
      expect(duplicateReverse.json().errors[0].code).toBe("CONFLICT");

      // 6. The original entry can still be voided independently.
      const voidResponse = await app.inject({
        method: "POST",
        url: `/api/gl/journal-entries/${created.id}/void`,
        headers,
      });

      expect(voidResponse.statusCode).toBe(200);
      expect(voidResponse.json().data.status).toBe("VOID");

      // 7. A second void must be rejected.
      const duplicateVoid = await app.inject({
        method: "POST",
        url: `/api/gl/journal-entries/${created.id}/void`,
        headers,
      });

      expect(duplicateVoid.statusCode).toBe(400);
      expect(duplicateVoid.json().errors[0].code).toBe(
        "VALIDATION_ERROR",
      );

      // 8. The voided original must not contribute to the ledger.
      const ledger = await app.inject({
        method: "GET",
        url: `/api/gl/accounts/${cash!.id}/ledger?fromDate=2026-08-12&toDate=2026-08-12`,
        headers,
      });

      expect(ledger.statusCode).toBe(200);

      const ledgerData = ledger.json().data;

      const originalLedgerLine = ledgerData.lines.find(
        (line: {
          journalEntryId: string;
        }) => line.journalEntryId === created.id,
      );

      expect(originalLedgerLine).toBeUndefined();

      const reversalLedgerLine = ledgerData.lines.find(
        (line: {
          journalEntryId: string;
        }) => line.journalEntryId === reversal.id,
      );

      expect(reversalLedgerLine).toBeDefined();
      expect(reversalLedgerLine.debit).toBe(0);
      expect(reversalLedgerLine.credit).toBe(125);
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent reversal", async () => {
    const app = await buildApp();

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          tenantCode: "MODLER",
          email: "admin@modler.local",
          password: "ModlerAdmin@2026!",
        },
      });

      expect(login.statusCode).toBe(200);

      const headers = {
        authorization: `Bearer ${login.json().data.token}`,
      };

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: {
          code: "MODLER",
        },
      });

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: tenant.id,
          code: {
            in: ["1000", "4000"],
          },
          active: true,
        },
      });

      const cash = accounts.find((account) => account.code === "1000");
      const revenue = accounts.find((account) => account.code === "4000");

      expect(cash).toBeDefined();
      expect(revenue).toBeDefined();

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/gl/journal-entries",
        headers,
        payload: {
          organizationId,
          entryNumber: `JE-CONCURRENT-REV-${suffix}`,
          entryDate: "2026-08-13",
          description: `Concurrent reversal test ${suffix}`,
          sourceType: "ConcurrentReversalTest",
          sourceId: `CONCURRENT-REVERSAL-${suffix}`,
          status: "DRAFT",
          lines: [
            {
              accountId: cash!.id,
              debit: 200,
              credit: 0,
              description: "Concurrent reversal cash",
            },
            {
              accountId: revenue!.id,
              debit: 0,
              credit: 200,
              description: "Concurrent reversal revenue",
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const created = create.json().data;

      const post = await app.inject({
        method: "POST",
        url: `/api/gl/journal-entries/${created.id}/post`,
        headers,
      });

      expect(post.statusCode).toBe(200);
      expect(post.json().data.status).toBe("POSTED");

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/gl/journal-entries/${created.id}/reverse`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/api/gl/journal-entries/${created.id}/reverse`,
          headers,
        }),
      ]);

      const results = [first, second];

      const successful = results.filter(
        (result) => result.statusCode === 201,
      );

      const rejected = results.filter(
        (result) => result.statusCode === 409,
      );

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const reversals = await prisma.journalEntry.findMany({
        where: {
          tenantId: tenant.id,
          sourceType: "JournalEntryReversal",
          sourceId: created.id,
        },
      });

      expect(reversals).toHaveLength(1);

      expect(reversals[0].status).toBe("POSTED");
    } finally {
      await app.close();
    }
  });

  it("rejects an unbalanced journal entry", async () => {
    const app = await buildApp();

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          tenantCode: "MODLER",
          email: "admin@modler.local",
          password: "ModlerAdmin@2026!",
        },
      });

      expect(login.statusCode).toBe(200);

      const headers = {
        authorization: `Bearer ${login.json().data.token}`,
      };

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: {
          code: "MODLER",
        },
      });

      const cash = await prisma.glAccount.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "1000",
          active: true,
        },
      });

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/gl/journal-entries",
        headers,
        payload: {
          organizationId,
          entryNumber: `JE-UNBALANCED-TEST-${suffix}`,
          entryDate: "2026-08-12",
          description: `Unbalanced accounting test ${suffix}`,
          sourceType: "AccountingTest",
          sourceId: `UNBALANCED-TEST-${suffix}`,
          status: "DRAFT",
          lines: [
            {
              accountId: cash.id,
              debit: 100,
              credit: 0,
              description: "Unbalanced test",
            },
            {
              accountId: cash.id,
              debit: 0,
              credit: 50,
              description: "Unbalanced test",
            },
          ],
        },
      });

      expect(create.statusCode).toBe(400);

      const body = create.json();

      expect(body.errors).toBeDefined();
      expect(body.errors[0].code).toBe("VALIDATION_ERROR");
      expect(body.errors[0].message).toContain("balanced");
    } finally {
      await app.close();
    }
  });

});
