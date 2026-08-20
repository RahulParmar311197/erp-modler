import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../auth/authorization', () => ({
  authenticate: async (request: any, reply: any) => { request.user = { sub: 'user-1', tenantId: 'MODLER', organizationId: 'org-1' }; },
  requirePermission: async () => undefined,
}));

const postJournalMock = vi.fn(async () => ({ id: 'je-1' }));
vi.mock('../../accounting/journal-service', () => ({ postJournalEntry: postJournalMock }));

import { purchaseOrderRoutes } from '../../modules/purchasing/purchase-orders';
import { goodsReceiptRoutes } from '../../modules/receiving/routes';

describe('purchase -> gr flow (unit)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => { app = Fastify(); });

  it('creates a purchase order and posts goods receipt with stock movement and journal entry', async () => {
    const mockPrisma: any = {
      organization: { findFirst: vi.fn(async () => ({ id: 'org-1', tenantId: 'MODLER', active: true })) },
      supplier: { findFirst: vi.fn(async () => ({ id: 'sup-1', tenantId: 'MODLER', active: true, currency: 'INR' })) },
      purchaseOrder: {
        create: vi.fn(async ({ data }: any) => ({ id: 'po-1', ...data })),
        findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })),
        findFirst: vi.fn(async () => ({ id: 'po-1', lines: [{ id: 'pol-1', itemId: 'item-1', unitPrice: 10, quantity: 5, purchaseOrderId: 'po-1' }], organizationId: 'org-1' })),
      },
      purchaseOrderLine: { create: vi.fn(async () => ({ id: 'pol-1' })), findUnique: vi.fn(async () => ({ id: 'pol-1', itemId: 'item-1', unitPrice: 10, quantity: 5 })) },
      goodsReceipt: { create: vi.fn(async ({ data }: any) => ({ id: 'gr-1', ...data })), findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })) },
      goodsReceiptLine: { create: vi.fn(async () => ({ id: 'grl-1' })) },
      stockMovement: { create: vi.fn(async () => ({ id: 'sm-1' })) },
      stockBalance: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'sb-1' })), update: vi.fn(async () => ({ id: 'sb-1' })) },
      $transaction: vi.fn(async (fn: any) => {
        const tx = { ...mockPrisma, $transaction: mockPrisma.$transaction };
        return fn(tx);
      }),
    };

    await purchaseOrderRoutes(app, mockPrisma as any);
    await goodsReceiptRoutes(app, mockPrisma as any);

    // Create PO
    const poResp = await app.inject({ method: 'POST', url: '/api/purchase-orders', payload: { organizationId: 'org-1', supplierId: 'sup-1', lines: [{ itemId: 'item-1', uomId: 'uom-1', quantity: 5, unitPrice: 10 }] } });
    expect(poResp.statusCode).toBe(201);

    // Create GR
    const grResp = await app.inject({ method: 'POST', url: '/api/receiving/goods-receipts', payload: { purchaseOrderId: 'po-1', lines: [{ purchaseOrderLineId: 'pol-1', itemId: 'item-1', warehouseId: 'wh-1', quantity: 5 }] } });
    expect(grResp.statusCode).toBe(201);

    // Ensure journal entry was called
    expect(postJournalMock).toHaveBeenCalled();
  });
});
