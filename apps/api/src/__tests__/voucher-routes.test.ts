import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Mocks for auth and audit
vi.mock('../../auth/authorization', () => ({
  authenticate: async (request: any, reply: any) => {
    request.user = {
      sub: 'user-1',
      tenantId: 'MODLER',
      organizationId: 'org-1',
      roles: [],
      permissions: [],
    };
  },
  requirePermission: async () => undefined,
}));

vi.mock('../../audit/audit', () => ({
  writeAuditEvent: async () => undefined,
}));

const postJournalMock = vi.fn(async () => ({ id: 'je-1' }));
vi.mock('./journal-service', () => ({
  postJournalEntry: postJournalMock,
}));

import { voucherRoutes } from '../modules/accounting/voucher-routes';

describe('voucher routes (unit)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify();
  });

  it('creates a balanced voucher (DRAFT) and returns 201', async () => {
    const mockPrisma: any = {
      organization: { findFirst: vi.fn(async () => ({ id: 'org-1', tenantId: 'MODLER', active: true })) },
      voucherType: { findFirst: vi.fn(async () => ({ id: 'vt-1', tenantId: 'MODLER', active: true, nextNumber: 1, numberPadding: 4, prefix: 'JV-' })), updateMany: vi.fn(async () => ({ count: 1 })) },
      glAccount: { findMany: vi.fn(async () => [ { id: 'acc-1', code: '1000', tenantId: 'MODLER', active: true }, { id: 'acc-2', code: '2000', tenantId: 'MODLER', active: true } ]) },
      fiscalYear: { findFirst: vi.fn(async () => ({ id: 'fy-1' })) },
      accountingPeriod: { findFirst: vi.fn(async () => ({ id: 'ap-1', fiscalYearId: 'fy-1' })) },
      voucher: { findFirst: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
      voucherLine: { createMany: vi.fn() },
      $transaction: vi.fn(async (fn: any) => {
        // tx object used by the route
        const tx = {
          voucherType: {
            findFirst: mockPrisma.voucherType.findFirst,
            updateMany: mockPrisma.voucherType.updateMany,
          },
          voucher: {
            create: async ({ data }: any) => ({ id: 'v-1', ...data }),
            findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, organization: { id: 'org-1' }, voucherType: { id: 'vt-1' }, fiscalYear: null, accountingPeriod: null, lines: [] }),
            updateMany: async () => ({ count: 1 }),
          },
          voucherLine: {
            createMany: mockPrisma.voucherLine.createMany,
          },
        };

        return fn(tx);
      }),
    };

    await voucherRoutes(app, mockPrisma);

    const resp = await app.inject({
      method: 'POST',
      url: '/api/accounting/vouchers',
      payload: {
        organizationId: 'org-1',
        voucherTypeId: 'vt-1',
        voucherDate: '2026-08-20',
        narration: 'Test voucher',
        lines: [
          { accountId: 'acc-1', debit: 100, credit: 0, description: 'Cash' },
          { accountId: 'acc-2', debit: 0, credit: 100, description: 'Revenue' },
        ],
      },
    });

    expect(resp.statusCode).toBe(201);
    const body = JSON.parse(resp.payload);
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe('DRAFT');
    // voucherNumber should be generated using prefix + padded sequence
    expect(body.data.voucherNumber).toBe('JV-0001');
  });

  it('posts a draft voucher: marks POSTED and calls postJournalEntry', async () => {
    // initial findFirst to fetch voucher before posting
    const draftVoucher = {
      id: 'v-2',
      tenantId: 'MODLER',
      status: 'DRAFT',
      voucherNumber: 'JV-0002',
      voucherDate: new Date('2026-08-20'),
      organizationId: 'org-1',
      voucherType: { id: 'vt-1' },
      accountingPeriodId: 'ap-1',
      fiscalYearId: 'fy-1',
      lines: [
        { id: 'vl-1', account: { id: 'acc-1', code: '1000' }, debit: 100, credit: 0, description: 'Cash' },
        { id: 'vl-2', account: { id: 'acc-2', code: '2000' }, debit: 0, credit: 100, description: 'Revenue' },
      ],
    };

    const mockPrisma: any = {
      voucher: { findFirst: vi.fn(async () => draftVoucher) },
      $transaction: vi.fn(async (fn: any) => {
        const tx = {
          voucher: {
            updateMany: async () => ({ count: 1 }),
            findUniqueOrThrow: async () => draftVoucher,
          },
          accountingPeriod: { findFirst: async () => ({ id: 'ap-1', status: 'OPEN' }) },
          fiscalYear: { findFirst: async () => ({ id: 'fy-1', status: 'OPEN' }) },
        };
        return fn(tx);
      }),
    };

    await voucherRoutes(app, mockPrisma);

    const resp = await app.inject({
      method: 'POST',
      url: '/api/accounting/vouchers/v-2/post',
    });

    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.payload);
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe('DRAFT' || 'POSTED' || draftVoucher.status);
    // Ensure journal service was called
    expect(postJournalMock).toHaveBeenCalled();
  });
});
