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

  it("allows only one concurrent void of the same journal entry", async () => {
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
          entryNumber: `JE-CONCURRENT-VOID-${suffix}`,
          entryDate: "2026-08-13",
          description: `Concurrent void test ${suffix}`,
          sourceType: "ConcurrentVoidTest",
          sourceId: `CONCURRENT-VOID-${suffix}`,
          status: "DRAFT",
          lines: [
            {
              accountId: cash!.id,
              debit: 200,
              credit: 0,
              description: "Concurrent void cash",
            },
            {
              accountId: revenue!.id,
              debit: 0,
              credit: 200,
              description: "Concurrent void revenue",
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
          url: `/api/gl/journal-entries/${created.id}/void`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/api/gl/journal-entries/${created.id}/void`,
          headers,
        }),
      ]);

      const results = [first, second];

      const successful = results.filter(
        (result) => result.statusCode === 200,
      );

      const rejected = results.filter(
        (result) => result.statusCode === 400,
      );

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      expect(rejected[0].json().errors[0].code).toBe(
        "VALIDATION_ERROR",
      );

      const finalEntry =
        await prisma.journalEntry.findUniqueOrThrow({
          where: {
            id: created.id,
          },
        });

      expect(finalEntry.status).toBe("VOID");
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent posting of the same journal entry", async () => {
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
          entryNumber: `JE-CONCURRENT-POST-${suffix}`,
          entryDate: "2026-08-13",
          description: `Concurrent posting test ${suffix}`,
          sourceType: "ConcurrentPostingTest",
          sourceId: `CONCURRENT-POST-${suffix}`,
          lines: [
            {
              accountId: cash!.id,
              debit: 200,
              credit: 0,
              description: "Concurrent posting cash",
            },
            {
              accountId: revenue!.id,
              debit: 0,
              credit: 200,
              description: "Concurrent posting revenue",
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const created = create.json().data;

      expect(created.status).toBe("DRAFT");

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/gl/journal-entries/${created.id}/post`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/api/gl/journal-entries/${created.id}/post`,
          headers,
        }),
      ]);

      const results = [first, second];

      const successful = results.filter(
        (result) => result.statusCode === 200,
      );

      const rejected = results.filter(
        (result) => result.statusCode === 400,
      );

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const finalEntry =
        await prisma.journalEntry.findUniqueOrThrow({
          where: {
            id: created.id,
          },
        });

      expect(finalEntry.status).toBe("POSTED");
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


  it("creates and posts a voucher into the GL", async () => {
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
        where: { code: "MODLER" },
      });

      const organization = await prisma.organization.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "MODLER-IN",
        },
      });

      const voucherType =
        await prisma.voucherType.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            code: "JOURNAL",
            active: true,
          },
        });

      const fiscalYear =
        await prisma.fiscalYear.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            code: "FY2026",
            status: "OPEN",
          },
        });

      const period =
        await prisma.accountingPeriod.findFirstOrThrow({
          where: {
            tenantId: tenant.id,
            code: "FY2026-P05",
            status: "OPEN",
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

      const cash = accounts.find(
        (account) => account.code === "1000",
      );

      const revenue = accounts.find(
        (account) => account.code === "4000",
      );

      expect(cash).toBeDefined();
      expect(revenue).toBeDefined();

      const suffix = Date.now();

      const create = await app.inject({
        method: "POST",
        url: "/api/accounting/vouchers",
        headers,
        payload: {
          organizationId: organization.id,
          voucherTypeId: voucherType.id,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          voucherDate: "2026-08-12",
          referenceNumber: `TEST-${suffix}`,
          narration: `Voucher integration test ${suffix}`,
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

      const voucher = create.json().data;

      expect(voucher.status).toBe("DRAFT");
      expect(voucher.voucherTypeId).toBe(voucherType.id);
      expect(voucher.fiscalYearId).toBe(fiscalYear.id);
      expect(voucher.accountingPeriodId).toBe(period.id);
      expect(voucher.lines).toHaveLength(2);

      const post = await app.inject({
        method: "POST",
        url: `/api/accounting/vouchers/${voucher.id}/post`,
        headers,
      });

      expect(post.statusCode).toBe(200);
      expect(post.json().data.status).toBe("POSTED");

      const journal = await prisma.journalEntry.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          sourceType: "Voucher",
          sourceId: voucher.id,
        },
        include: {
          lines: {
            include: {
              account: true,
            },
          },
        },
      });

      expect(journal.status).toBe("POSTED");
      expect(journal.entryNumber).toBe(
        `JV-${voucher.voucherNumber}`,
      );
      expect(journal.fiscalYearId).toBe(fiscalYear.id);
      expect(journal.accountingPeriodId).toBe(period.id);
      expect(journal.lines).toHaveLength(2);

      const journalDebit = journal.lines.reduce(
        (sum, line) => sum + Number(line.debit),
        0,
      );

      const journalCredit = journal.lines.reduce(
        (sum, line) => sum + Number(line.credit),
        0,
      );

      expect(journalDebit).toBe(125);
      expect(journalCredit).toBe(125);
    } finally {
      await app.close();
    }

  });
  it("allows only one concurrent posting of the same voucher", async () => {
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
        where: { code: "MODLER" },
      });

      const organization = await prisma.organization.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "MODLER-IN",
        },
      });

      const voucherType = await prisma.voucherType.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "JOURNAL",
          active: true,
        },
      });

      const fiscalYear = await prisma.fiscalYear.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "FY2026",
          status: "OPEN",
        },
      });

      const period = await prisma.accountingPeriod.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "FY2026-P05",
          status: "OPEN",
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
        url: "/api/accounting/vouchers",
        headers,
        payload: {
          organizationId: organization.id,
          voucherTypeId: voucherType.id,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          voucherDate: "2026-08-12",
          referenceNumber: `CONCURRENT-VOUCHER-${suffix}`,
          narration: `Concurrent voucher test ${suffix}`,
          lines: [
            {
              accountId: cash!.id,
              debit: 200,
              credit: 0,
            },
            {
              accountId: revenue!.id,
              debit: 0,
              credit: 200,
            },
          ],
        },
      });

      expect(create.statusCode).toBe(201);

      const voucher = create.json().data;

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/accounting/vouchers/${voucher.id}/post`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/api/accounting/vouchers/${voucher.id}/post`,
          headers,
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses).toEqual([200, 400]);

      const posted = await prisma.voucher.findUniqueOrThrow({
        where: {
          id: voucher.id,
        },
      });

      expect(posted.status).toBe("POSTED");

      const journals = await prisma.journalEntry.findMany({
        where: {
          tenantId: tenant.id,
          sourceType: "Voucher",
          sourceId: voucher.id,
        },
        include: {
          lines: true,
        },
      });

      expect(journals).toHaveLength(1);
      expect(journals[0].status).toBe("POSTED");
      expect(journals[0].lines).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent closing of the same accounting period", async () => {
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
        where: { code: "MODLER" },
      });

      const fiscalYear = await prisma.fiscalYear.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "FY2026",
        },
      });

      const suffix = Date.now();

      const existingPeriods = await prisma.accountingPeriod.findMany({
        where: { fiscalYearId: fiscalYear.id },
        select: { periodNumber: true },
      });
      const usedPeriodNumbers = new Set(
        existingPeriods.map((period) => period.periodNumber),
      );
      let periodNumber = 1;
      while (usedPeriodNumbers.has(periodNumber)) {
        periodNumber += 1;
      }

      const period = await prisma.accountingPeriod.create({
        data: {
          tenantId: tenant.id,
          fiscalYearId: fiscalYear.id,
          periodNumber,
          code: `CONCURRENT-CLOSE-${suffix}`,
          name: "Concurrent close test",
          startDate: new Date(`2026-08-${20 + (suffix % 5)}T00:00:00.000Z`),
          endDate: new Date(`2026-08-${21 + (suffix % 5)}T00:00:00.000Z`),
        },
      });

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/accounting/periods/${period.id}/close`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/api/accounting/periods/${period.id}/close`,
          headers,
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses).toEqual([200, 400]);

      const closed = await prisma.accountingPeriod.findUniqueOrThrow({
        where: {
          id: period.id,
        },
      });

      expect(closed.status).toBe("CLOSED");
      expect(closed.closedAt).toBeDefined();
      expect(closed.closedBy).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent closing of the same fiscal year", async () => {
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
        where: { code: "MODLER" },
      });

      const suffix = Date.now();

      const fiscalYear = await prisma.fiscalYear.create({
        data: {
          tenantId: tenant.id,
          code: `CONCURRENT-FY-${suffix}`,
          name: `Concurrent fiscal year ${suffix}`,
          startDate: new Date("2027-01-01T00:00:00.000Z"),
          endDate: new Date("2027-12-31T00:00:00.000Z"),
        },
      });

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/accounting/fiscal-years/${fiscalYear.id}/close`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/api/accounting/fiscal-years/${fiscalYear.id}/close`,
          headers,
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses).toEqual([200, 400]);

      const closed = await prisma.fiscalYear.findUniqueOrThrow({
        where: {
          id: fiscalYear.id,
        },
      });

      expect(closed.status).toBe("CLOSED");
      expect(closed.closedAt).toBeDefined();
      expect(closed.closedBy).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent creation of the same fiscal year code", async () => {
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

      const suffix = `${Date.now()}-${process.pid}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const testYear = 2400 + Math.floor(Math.random() * 500);
      const code = `CONCURRENT-CREATE-FY-${suffix}`;

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/accounting/fiscal-years",
          headers,
          payload: {
            code,
            name: `Concurrent fiscal year ${suffix}`,
            startDate: `${testYear}-01-01`,
            endDate: `${testYear}-12-31`,
          },
        }),
        app.inject({
          method: "POST",
          url: "/api/accounting/fiscal-years",
          headers,
          payload: {
            code,
            name: `Concurrent fiscal year ${suffix}`,
            startDate: `${testYear}-01-01`,
            endDate: `${testYear}-12-31`,
          },
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses).toEqual([201, 409]);

      const created = await prisma.fiscalYear.findMany({
        where: {
          code,
        },
      });

      expect(created).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("allows only one concurrent creation of the same accounting period", async () => {
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

      const suffix = `${Date.now()}-${process.pid}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const testYear = 2200 + (Date.now() % 100);

      const fiscalYear = await prisma.fiscalYear.create({
        data: {
          tenantId: tenant.id,
          code: `CONCURRENT-PERIOD-FY-${suffix}`,
          name: `Concurrent period fiscal year ${suffix}`,
          startDate: new Date(`${testYear}-01-01T00:00:00.000Z`),
          endDate: new Date(`${testYear}-12-31T00:00:00.000Z`),
        },
      });

      const payload = {
        fiscalYearId: fiscalYear.id,
        periodNumber: 1,
        code: `CONCURRENT-CREATE-PERIOD-${suffix}`,
        name: `Concurrent period ${suffix}`,
        startDate: `${testYear}-01-01`,
        endDate: `${testYear}-01-31`,
      };

      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/accounting/periods",
          headers,
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/api/accounting/periods",
          headers,
          payload,
        }),
      ]);

      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses).toEqual([201, 409]);

      const created = await prisma.accountingPeriod.findMany({
        where: {
          tenantId: tenant.id,
          fiscalYearId: fiscalYear.id,
          periodNumber: payload.periodNumber,
          code: payload.code,
        },
      });

      expect(created).toHaveLength(1);
      expect(created[0].code).toBe(payload.code);
    } finally {
      await app.close();
    }
  });

  it("rejects posting a voucher when its accounting period is closed", async () => {
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
        where: { code: "MODLER" },
      });

      const organization = await prisma.organization.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "MODLER-IN",
          active: true,
        },
      });

      const voucherType = await prisma.voucherType.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "JOURNAL",
          active: true,
        },
      });

      const period = await prisma.accountingPeriod.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "FY2026-P05",
        },
      });

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: tenant.id,
          code: { in: ["1000", "4000"] },
          active: true,
        },
      });

      const cash = accounts.find((a) => a.code === "1000");
      const revenue = accounts.find((a) => a.code === "4000");

      expect(cash).toBeDefined();
      expect(revenue).toBeDefined();

      const suffix = Date.now();

      // Create the voucher while the period is still open.
      const create = await app.inject({
          method: "POST",
          url: "/api/accounting/vouchers",
          headers,
          payload: {
            organizationId: organization.id,
            voucherTypeId: voucherType.id,
            fiscalYearId: period.fiscalYearId,
            accountingPeriodId: period.id,
            voucherNumber: `CLOSED-PERIOD-${suffix}`,
            voucherDate: "2026-08-20",
            narration: `Closed period test ${suffix}`,
            lines: [
              {
                accountId: cash!.id,
                debit: 100,
                credit: 0,
              },
              {
                accountId: revenue!.id,
                debit: 0,
                credit: 100,
              },
            ],
          },
        });

      expect(create.statusCode).toBe(201);

      const voucher = create.json().data;

      // Close the period after voucher creation.
      await prisma.accountingPeriod.update({
        where: { id: period.id },
        data: { status: "CLOSED" },
      });

      try {
        const post = await app.inject({
          method: "POST",
          url: `/api/accounting/vouchers/${voucher.id}/post`,
          headers,
        });

        expect(post.statusCode).toBe(400);
        expect(post.json().errors[0].code).toBe(
          "VALIDATION_ERROR",
        );

        expect(
          post.json().errors[0].message,
        ).toContain("accounting period is closed");

        const journal = await prisma.journalEntry.findFirst({
          where: {
            tenantId: tenant.id,
            sourceType: "Voucher",
            sourceId: voucher.id,
          },
        });

        expect(journal).toBeNull();
      } finally {
        await prisma.accountingPeriod.update({
          where: { id: period.id },
          data: { status: "OPEN" },
        });
      }
    } finally {
      await app.close();
    }
  });

  it("rejects posting a voucher when its fiscal year is closed", async () => {
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
        where: { code: "MODLER" },
      });

      const organization = await prisma.organization.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "MODLER-IN",
          active: true,
        },
      });

      const voucherType = await prisma.voucherType.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "JOURNAL",
          active: true,
        },
      });

      const fiscalYear = await prisma.fiscalYear.findFirstOrThrow({
        where: {
          tenantId: tenant.id,
          code: "FY2026",
        },
      });

      const accounts = await prisma.glAccount.findMany({
        where: {
          tenantId: tenant.id,
          code: { in: ["1000", "4000"] },
          active: true,
        },
      });

      const cash = accounts.find((a) => a.code === "1000");
      const revenue = accounts.find((a) => a.code === "4000");

      expect(cash).toBeDefined();
      expect(revenue).toBeDefined();

      await prisma.fiscalYear.update({
        where: { id: fiscalYear.id },
        data: { status: "CLOSED" },
      });

      try {
        const suffix = Date.now();

        const create = await app.inject({
          method: "POST",
          url: "/api/accounting/vouchers",
          headers,
          payload: {
            organizationId: organization.id,
            voucherTypeId: voucherType.id,
            fiscalYearId: fiscalYear.id,
            voucherNumber: `CLOSED-FY-${suffix}`,
            voucherDate: "2026-08-21",
            narration: `Closed fiscal year test ${suffix}`,
            lines: [
              {
                accountId: cash!.id,
                debit: 100,
                credit: 0,
              },
              {
                accountId: revenue!.id,
                debit: 0,
                credit: 100,
              },
            ],
          },
        });

        expect(create.statusCode).toBe(400);
        expect(create.json().errors[0].code).toBe(
          "VALIDATION_ERROR",
        );
        expect(
          create.json().errors[0].message,
        ).toContain("Fiscal year is invalid, closed");

      } finally {
        await prisma.fiscalYear.update({
          where: { id: fiscalYear.id },
          data: { status: "OPEN" },
        });
      }
    } finally {
      await app.close();
    }
  });
});
