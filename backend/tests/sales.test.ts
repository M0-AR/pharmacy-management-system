import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db.js';
import { auth, createCustomer, createMedicine, createUser, setupCtx, teardownCtx, type Ctx } from './helpers.js';

const H = { 'content-type': 'application/json' };

describe('sales, voids & returns', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('validates payloads, references, expiry and stock', async () => {
    const med = await createMedicine({ quantity: 5, unitPrice: 10 });
    const expired = await createMedicine({ quantity: 5, unitPrice: 10, expiryDate: new Date('2020-01-01') });
    const post = (payload: unknown, token = ctx.adminToken) =>
      ctx.app.inject({ method: 'POST', url: '/api/sales', headers: { ...H, ...auth(token) }, payload });
    assert.equal((await post({ items: [] })).statusCode, 400);
    assert.equal((await post({ items: [{ medicineId: 'nope', qty: 1 }] })).statusCode, 400);
    assert.equal((await post({ items: [{ medicineId: med.id, qty: 1 }], customerId: 'nope' })).statusCode, 400);
    assert.equal((await post({ items: [{ medicineId: expired.id, qty: 1 }] })).statusCode, 400);
    assert.equal((await post({ items: [{ medicineId: med.id, qty: 99 }] })).statusCode, 400);
  });

  it('computes discount/tax math exactly and decrements stock with ledger', async () => {
    const med = await createMedicine({ quantity: 20, unitPrice: 5.5 });
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/sales', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { items: [{ medicineId: med.id, qty: 2 }], discountPct: 10, taxPct: 6, paymentMethod: 'CARD' },
    });
    assert.equal(res.statusCode, 201);
    // 5.50*2=11.00 −10%=9.90 +6%=10.494 → 10.49
    assert.equal(res.json().sale.total, 10.49);
    assert.equal((await prisma.medicine.findUniqueOrThrow({ where: { id: med.id } })).quantity, 18);
    const mov = await prisma.stockMovement.findMany({ where: { medicineId: med.id, reason: 'SALE' } });
    assert.equal(mov.reduce((s, m) => s + m.changeQty, 0), -2);
  });

  it('Rx gate: cashier blocked, pharmacist passes', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    const pharm = await createUser(ctx.app, { role: 'PHARMACIST' });
    const rx = await createMedicine({ quantity: 10, rxType: 'RX' });
    const otc = await createMedicine({ quantity: 10, rxType: 'OTC' });
    const post = (token: string, id: string) =>
      ctx.app.inject({ method: 'POST', url: '/api/sales', headers: { ...H, ...auth(token) }, payload: { items: [{ medicineId: id, qty: 1 }] } });
    assert.equal((await post(cash.token, rx.id)).statusCode, 403);
    assert.equal((await post(cash.token, otc.id)).statusCode, 201);
    assert.equal((await post(pharm.token, rx.id)).statusCode, 201);
  });

  it('HIGH DUR warnings require documented acknowledgment', async () => {
    const cust = await createCustomer({ allergies: 'ibuprofen' });
    const ibu = await createMedicine({ name: 'Ibuprofen-Test', genericName: 'Ibuprofen', quantity: 10 });
    const check = await ctx.app.inject({
      method: 'POST', url: '/api/dur/check', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { customerId: cust.id, items: [{ medicineId: ibu.id }] },
    });
    const warnings = check.json().warnings as { type: string; severity: string; message: string }[];
    assert.ok(warnings.some((w) => w.type === 'drug-allergy' && w.severity === 'high'));
    const base = { customerId: cust.id, items: [{ medicineId: ibu.id, qty: 1 }] };
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/sales', headers: { ...H, ...auth(ctx.adminToken) }, payload: base })).statusCode, 409);
    const acked = await ctx.app.inject({
      method: 'POST', url: '/api/sales', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { ...base, durAck: { warnings, note: 'Test rationale' } },
    });
    assert.equal(acked.statusCode, 201);
  });

  it('void restores stock; double void and cashier void are rejected', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    const med = await createMedicine({ quantity: 10 });
    const sale = await ctx.app.inject({
      method: 'POST', url: '/api/sales', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { items: [{ medicineId: med.id, qty: 3 }] },
    });
    const id = sale.json().sale.id as string;
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/sales/${id}/void`, headers: auth(cash.token) })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/sales/${id}/void`, headers: auth(ctx.adminToken) })).statusCode, 200);
    assert.equal((await prisma.medicine.findUniqueOrThrow({ where: { id: med.id } })).quantity, 10);
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/sales/${id}/void`, headers: auth(ctx.adminToken) })).statusCode, 400);
  });

  it('partial returns restock exactly; over-returns are impossible', async () => {
    const med = await createMedicine({ quantity: 10, unitPrice: 7 });
    const sale = await ctx.app.inject({
      method: 'POST', url: '/api/sales', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { items: [{ medicineId: med.id, qty: 4 }] },
    });
    const id = sale.json().sale.id as string;
    const ret = (payload: unknown) =>
      ctx.app.inject({ method: 'POST', url: `/api/sales/${id}/returns`, headers: { ...H, ...auth(ctx.adminToken) }, payload });
    assert.equal((await ret({ items: [{ medicineId: med.id, qty: 5 }], reason: 'too many here' })).statusCode, 400);
    assert.equal((await ret({ items: [{ medicineId: med.id, qty: 1 }], reason: 'Unopened, test' })).statusCode, 200);
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/sales/${id}`, headers: auth(ctx.adminToken) });
    assert.deepEqual(detail.json().sale.returns, [{ medicineId: med.id, qty: 1 }]);
    assert.equal(detail.json().sale.refundedTotal, 7);
    assert.equal((await prisma.medicine.findUniqueOrThrow({ where: { id: med.id } })).quantity, 7);
    assert.equal((await ret({ items: [{ medicineId: med.id, qty: 4 }], reason: 'rest of it' })).statusCode, 400);
  });
});
