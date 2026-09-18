import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auth, createCustomer, createMedicine, createUser, setupCtx, teardownCtx, type Ctx } from './helpers.js';
import { prisma } from '../src/lib/db.js';

const H = { 'content-type': 'application/json' };

describe('DUR-lite clinical screening', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('requires authentication and a real customer', async () => {
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/dur/check', headers: H, payload: { customerId: 'x', items: [] } })).statusCode, 401);
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(cash.token) }, payload: { customerId: 'nope', items: [{ medicineId: 'x' }] } })).statusCode, 400);
  });

  it('flags drug-allergy matches as HIGH', async () => {
    const cust = await createCustomer({ allergies: 'Sulfa drugs — hives' });
    const sulfa = await createMedicine({ name: 'Sulfamethoxazole-Test', genericName: 'Sulfamethoxazole', quantity: 5 });
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { customerId: cust.id, items: [{ medicineId: sulfa.id }] },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().warnings.some((w: { type: string; severity: string }) => w.type === 'drug-allergy' && w.severity === 'high'));
  });

  it('stays silent when nothing matches', async () => {
    const cust = await createCustomer({ allergies: 'Latex' });
    const med = await createMedicine({ name: 'Plain-Test', genericName: 'Plainamine', brand: 'Plainco', quantity: 5 });
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { customerId: cust.id, items: [{ medicineId: med.id }] },
    });
    assert.deepEqual(res.json().warnings, []);
  });

  it('detects duplicate therapy from 120-day history, then same-class', async () => {
    const cust = await createCustomer({});
    const first = await createMedicine({ genericName: 'Dupamine', category: 'Tablets', quantity: 10 });
    await prisma.sale.create({
      data: {
        invoiceNo: `INV-dup-${Date.now()}`, subtotal: 5, total: 5, paymentMethod: 'CASH', customerId: cust.id,
        soldById: ctx.admin.id, createdAt: new Date(Date.now() - 10 * 864e5),
        items: { create: [{ medicineId: first.id, qty: 1, unitPrice: 5, lineTotal: 5 }] },
      },
    });
    // Same generic, different product → duplicate-therapy HIGH.
    const second = await createMedicine({ genericName: 'Dupamine', category: 'Tablets', quantity: 10 });
    const dup = await ctx.app.inject({
      method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { customerId: cust.id, items: [{ medicineId: second.id }] },
    });
    assert.ok(dup.json().warnings.some((w: { type: string }) => w.type === 'duplicate-therapy'));
    // Same category, different generic → same-class MEDIUM.
    const cousin = await createMedicine({ genericName: 'Cousinamine', category: 'Tablets', quantity: 10 });
    const cls = await ctx.app.inject({
      method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { customerId: cust.id, items: [{ medicineId: cousin.id }] },
    });
    assert.ok(cls.json().warnings.some((w: { type: string; severity: string }) => w.type === 'same-class' && w.severity === 'medium'));
  });

  it('acknowledgment demands a rationale for HIGH warnings only', async () => {
    const cust = await createCustomer({ allergies: 'ibuprofen' });
    const ibu = await createMedicine({ genericName: 'Ibuprofen', quantity: 5 });
    const check = await ctx.app.inject({
      method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { customerId: cust.id, items: [{ medicineId: ibu.id }] },
    });
    const warnings = check.json().warnings;
    const base = { customerId: cust.id, items: [{ medicineId: ibu.id }], warnings };
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/dur/acknowledge', headers: { ...H, ...auth(ctx.adminToken) }, payload: { ...base, note: '' } })).statusCode, 400);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/dur/acknowledge', headers: { ...H, ...auth(ctx.adminToken) }, payload: { ...base, note: 'Test rationale' } })).statusCode, 200);
  });
});
