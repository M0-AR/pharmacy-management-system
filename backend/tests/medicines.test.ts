import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db.js';
import { auth, createMedicine, createUser, setupCtx, teardownCtx, uid, type Ctx } from './helpers.js';

const H = { 'content-type': 'application/json' };

describe('medicines & inventory ledger', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('rejects unauthenticated access', async () => {
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/medicines' })).statusCode, 401);
  });

  it('creates with opening PURCHASE movement; validates input; enforces roles', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    const good = { name: 'Ledger Test', category: 'Tablets', unitPrice: 4.5, quantity: 7, lowStockThreshold: 2 };
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/medicines', headers: { ...H, ...auth(cash.token) }, payload: good })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/medicines', headers: { ...H, ...auth(ctx.adminToken) }, payload: { ...good, unitPrice: -1 } })).statusCode, 400);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/medicines', headers: { ...H, ...auth(ctx.adminToken) }, payload: { unitPrice: 1 } })).statusCode, 400);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/medicines', headers: { ...H, ...auth(ctx.adminToken) }, payload: good });
    assert.equal(res.statusCode, 201);
    const mov = await prisma.stockMovement.findMany({ where: { medicineId: res.json().medicine.id } });
    assert.equal(mov.length, 1);
    assert.equal(mov[0]!.changeQty, 7);
    assert.equal(mov[0]!.reason, 'PURCHASE');
  });

  it('accepts date-picker YYYY-MM-DD expiry (E2E regression)', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/medicines', headers: { ...H, ...auth(ctx.adminToken) },
      payload: { name: `Dated ${uid()}`, category: 'Tablets', unitPrice: 1, quantity: 1, expiryDate: '2028-06-01' },
    });
    assert.equal(res.statusCode, 201);
    assert.ok(new Date(res.json().medicine.expiryDate).getFullYear() === 2028);
  });

  it('low-stock filter honors per-medicine thresholds, not a magic number', async () => {
    const low = await createMedicine({ name: `Low ${uid()}`, quantity: 11, lowStockThreshold: 15 });
    const ok = await createMedicine({ name: `Ok ${uid()}`, quantity: 11, lowStockThreshold: 10 });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/medicines?stock=low&pageSize=100', headers: auth(ctx.adminToken) });
    assert.equal(res.statusCode, 200);
    const ids = (res.json().items as { id: string }[]).map((m) => m.id);
    assert.ok(ids.includes(low.id), 'qty 11 / threshold 15 must be low');
    assert.ok(!ids.includes(ok.id), 'qty 11 / threshold 10 must not be low');
  });

  it('PUT quantity corrections write ledger deltas; unchanged qty writes nothing', async () => {
    const m = await createMedicine({ quantity: 50 });
    const before = await prisma.stockMovement.count({ where: { medicineId: m.id } });
    const up = await ctx.app.inject({ method: 'PUT', url: `/api/medicines/${m.id}`, headers: { ...H, ...auth(ctx.adminToken) }, payload: { quantity: 44 } });
    assert.equal(up.statusCode, 200);
    assert.equal(up.json().medicine.quantity, 44);
    const after = await prisma.stockMovement.findMany({ where: { medicineId: m.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(after.length, before + 1);
    assert.equal(after[0]!.changeQty, -6);
    assert.equal(after[0]!.reason, 'ADJUSTMENT');
    const same = await ctx.app.inject({ method: 'PUT', url: `/api/medicines/${m.id}`, headers: { ...H, ...auth(ctx.adminToken) }, payload: { quantity: 44 } });
    assert.equal(same.statusCode, 200);
    assert.equal(await prisma.stockMovement.count({ where: { medicineId: m.id } }), before + 1);
  });

  it('adjust guards: zero delta rejected, below-zero blocked, cashier forbidden', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    const m = await createMedicine({ quantity: 5 });
    const adj = (token: string, body: unknown) =>
      ctx.app.inject({ method: 'POST', url: `/api/medicines/${m.id}/adjust`, headers: { ...H, ...auth(token) }, payload: body });
    assert.equal((await adj(cash.token, { changeQty: 1 })).statusCode, 403);
    assert.equal((await adj(ctx.adminToken, { changeQty: 0 })).statusCode, 400);
    assert.equal((await adj(ctx.adminToken, { changeQty: -99 })).statusCode, 400);
    assert.equal((await adj(ctx.adminToken, { changeQty: 10, reason: 'PURCHASE', note: 'PO-1' })).statusCode, 200);
    assert.equal((await prisma.medicine.findUniqueOrThrow({ where: { id: m.id } })).quantity, 15);
  });

  it('delete is blocked by sales history, allowed otherwise (with ledger cleanup)', async () => {
    const withHistory = await createMedicine({ quantity: 10 });
    await prisma.sale.create({
      data: {
        invoiceNo: `INV-${uid()}`, subtotal: 10, total: 10, paymentMethod: 'CASH',
        soldById: ctx.admin.id, items: { create: [{ medicineId: withHistory.id, qty: 1, unitPrice: 10, lineTotal: 10 }] },
      },
    });
    assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/medicines/${withHistory.id}`, headers: auth(ctx.adminToken) })).statusCode, 409);
    const clean = await createMedicine({ quantity: 3 });
    await ctx.app.inject({ method: 'POST', url: `/api/medicines/${clean.id}/adjust`, headers: { ...H, ...auth(ctx.adminToken) }, payload: { changeQty: 2 } });
    assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/medicines/${clean.id}`, headers: auth(ctx.adminToken) })).statusCode, 200);
    assert.equal(await prisma.stockMovement.count({ where: { medicineId: clean.id } }), 0);
  });

  it('expired endpoint only lists past-dated stock', async () => {
    await createMedicine({ name: `Old ${uid()}`, expiryDate: new Date('2020-01-01') });
    await createMedicine({ name: `Fresh ${uid()}`, expiryDate: new Date('2030-01-01') });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/medicines/expired', headers: auth(ctx.adminToken) });
    const names = (res.json().items as { name: string }[]).map((m) => m.name);
    assert.ok(names.some((n) => n.startsWith('Old ')));
    assert.ok(!names.some((n) => n.startsWith('Fresh ')));
  });

  it('search finds by generic and code', async () => {
    const m = await createMedicine({ name: `Zigzag ${uid()}`, genericName: 'Zigzagamine' });
    const byGeneric = await ctx.app.inject({ method: 'GET', url: `/api/medicines?search=zigzagamine`, headers: auth(ctx.adminToken) });
    assert.ok((byGeneric.json().items as { id: string }[]).some((x) => x.id === m.id));
    const byCode = await ctx.app.inject({ method: 'GET', url: `/api/medicines?search=${m.code}`, headers: auth(ctx.adminToken) });
    assert.ok((byCode.json().items as { id: string }[]).some((x) => x.id === m.id));
  });
});
