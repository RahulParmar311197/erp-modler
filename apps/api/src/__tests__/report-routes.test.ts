import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../auth/authorization', () => ({
  authenticate: async (request: any, reply: any) => {
    request.user = { sub: 'user-1', tenantId: 'MODLER', organizationId: 'org-1' };
  },
  requirePermission: async () => undefined,
}));

import { reportRoutes } from '../../modules/accounting/report-routes';

describe('report routes (unit)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify();
  });

  it('returns trial balance aggregated from journal entries', async () => {
    const mockPrisma: any = {
      journalEntry: {
        findMany: vi.fn(async () => [
          {
            id: 'je-1',
            entryNumber: 'JE-1',
            lines: [
              { id: 'jl-1', debit: 100, credit: 0, account: { id: 'acc-1', code: '1000', name: 'Cash' } },
              { id: 'jl-2', debit: 0, credit: 100, account: { id: 'acc-2', code: '4000', name: 'Sales' } },
            ],
          },
        ]),
      },
    };

    await reportRoutes(app, mockPrisma);

    const resp = await app.inject({ method: 'GET', url: '/api/accounting/trial-balance' });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.payload);
    expect(Array.isArray(body.data)).toBe(true);
    const cash = body.data.find((r: any) => r.account.code === '1000');
    expect(cash.debit).toBe(100);
  });

  it('returns ledger rows with running balance', async () => {
    const mockPrisma: any = {
      journalLine: {
        findMany: vi.fn(async () => [
          { id: 'jl-1', debit: 100, credit: 0, journalEntry: { entryDate: new Date('2026-08-01'), entryNumber: 'JE-1' } },
          { id: 'jl-2', debit: 0, credit: 40, journalEntry: { entryDate: new Date('2026-08-02'), entryNumber: 'JE-2' } },
        ]),
      },
    };

    await reportRoutes(app, mockPrisma);

    const resp = await app.inject({ method: 'GET', url: '/api/accounting/ledgers/acc-1' });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.payload);
    expect(body.data[0].runningBalance).toBe(100);
    expect(body.data[1].runningBalance).toBe(60);
  });
});
