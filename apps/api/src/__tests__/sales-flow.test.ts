import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../auth/authorization', () => ({
  authenticate: async (request: any, reply: any) => { request.user = { sub: 'user-1', tenantId: 'MODLER', organizationId: 'org-1' }; },
  requirePermission: async () => undefined,
}));

const postJournalMock = vi.fn(async () => ({ id: 'je-1' }));
vi.mock('../../accounting/journal-service', () => ({ postJournalEntry: postJournalMock }));

import { salesOrderRoutes } from '../../modules/sales/sales-orders';
import { shipmentRoutes } from '../../modules/sales/shipment-routes';
import { salesInvoiceRoutes } from '../../modules/sales/invoice-routes';
import { customerPaymentRoutes } from '../../modules/sales/customer-payments';

describe('sales -> shipment -> invoice -> payment flow (unit)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => { app = Fastify(); });

  it('creates sales order, shipment (stock out + JE), invoice (AR/Revenue JE), and customer payment (JE)', async () => {
    const mockPrisma: any = {
      organization: { findFirst: vi.fn(async () => ({ id: 'org-1', tenantId: 'MODLER', active: true })) },
      customer: { findFirst: vi.fn(async () => ({ id: 'cust-1', tenantId: 'MODLER', active: true, currency: 'INR' })) },
      salesOrder: { create: vi.fn(async ({ data }: any) => ({ id: 'so-1', ...data })), findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })), findFirst: vi.fn(async () => ({ id: 'so-1', lines: [{ id: 'sol-1', itemId: 'item-1', unitPrice: 20, quantity: 2, salesOrderId: 'so-1' }], organizationId: 'org-1' })) },
      salesOrderLine: { create: vi.fn(async () => ({ id: 'sol-1' })), findUnique: vi.fn(async () => ({ id: 'sol-1', itemId: 'item-1', unitPrice: 20, quantity: 2 })) },
      shipment: { create: vi.fn(async ({ data }: any) => ({ id: 'sh-1', ...data })), findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })) },
      shipmentLine: { create: vi.fn(async () => ({ id: 'shl-1' })) },
      stockMovement: { create: vi.fn(async () => ({ id: 'sm-1' })) },
      stockBalance: { findFirst: vi.fn(async () => ({ id: 'sb-1', quantity: 10 })), update: vi.fn(async () => ({ id: 'sb-1' })) },
      salesInvoice: { create: vi.fn(async ({ data }: any) => ({ id: 'si-1', ...data })), findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })) },
      salesInvoiceLine: { create: vi.fn(async () => ({ id: 'sil-1' })) },
      customerPayment: { create: vi.fn(async ({ data }: any) => ({ id: 'cp-1', ...data })), findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: where.id })) },
      $transaction: vi.fn(async (fn: any) => {
        const tx = { ...mockPrisma, $transaction: mockPrisma.$transaction };
        return fn(tx);
      }),
    };

    await salesOrderRoutes(app, mockPrisma as any);
    await shipmentRoutes(app, mockPrisma as any);
    await salesInvoiceRoutes(app, mockPrisma as any);
    await customerPaymentRoutes(app, mockPrisma as any);

    // Create SO
    const soResp = await app.inject({ method: 'POST', url: '/api/sales/orders', payload: { organizationId: 'org-1', customerId: 'cust-1', lines: [{ itemId: 'item-1', uomId: 'uom-1', quantity: 2, unitPrice: 20 }] } });
    expect(soResp.statusCode).toBe(201);

    // Create Shipment
    const shResp = await app.inject({ method: 'POST', url: '/api/sales/shipments', payload: { salesOrderId: 'so-1', lines: [{ salesOrderLineId: 'sol-1', itemId: 'item-1', warehouseId: 'wh-1', quantity: 2 }] } });
    expect(shResp.statusCode).toBe(201);

    // Create Invoice
    const siResp = await app.inject({ method: 'POST', url: '/api/sales/invoices', payload: { organizationId: 'org-1', customerId: 'cust-1', lines: [{ itemId: 'item-1', quantity: 2, unitPrice: 20 }] } });
    expect(siResp.statusCode).toBe(201);

    // Customer Payment
    const cpResp = await app.inject({ method: 'POST', url: '/api/sales/customer-payments', payload: { salesInvoiceId: 'si-1', bankAccountId: 'bank-1', amount: 40 } });
    expect(cpResp.statusCode).toBe(201);

    // Journal called for shipment (COGS), invoice (AR/Sales), and payment
    expect(postJournalMock).toHaveBeenCalledTimes(3);
  });
});
