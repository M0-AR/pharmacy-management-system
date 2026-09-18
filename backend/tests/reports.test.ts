import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db.js';
import { auth, createCustomer, createMedicine, createSupplier, createUser, setupCtx, teardownCtx, type Ctx } from './helpers.js';

describe('reports, settings & audit', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('summary numbers reconcile with the database', async () => {
    const a = await createMedicine({ quantity: 3, lowStockThreshold: 5, unitPrice: 10 });
    const b = await createMedicine({ quantity: 50, lowStockThreshold: 5, unitPrice: 2, expiryDate: new Date('2020-01-01') });
    const cust = await createCustomer({});
    await prisma.sale.create({
      data: {
        invoiceNo: `INV-r-${Date.now()}`, subtotal: 30, total: 30, paymentMethod: 'CASH', customerId: cust.id,
        soldById: ctx.admin.id, items: { create: [{ medicineId: a.id, qty: 1, unitPrice: 10, lineTotal: 10 }] },
      },
    });
    await createSupplier({});
    const res = await ctx.app.inject({ method: 'GET', url: '/api/reports/summary', headers: auth(ctx.adminToken) });
    assert.equal(res.statusCode, 200);
    const t = res.json().totals;
    assert.equal(t.medicines, await prisma.medicine.count());
    assert.equal(t.customers, await prisma.customer.count());
    assert.equal(t.revenue, Number((await prisma.sale.aggregate({ where: { status: 'COMPLETED' }, _sum: { total: true } }))._sum.total ?? 0));
    assert.ok(t.lowStock >= 1 && t.expired >= 1);
    assert.ok(Array.isArray(res.json().salesByDay) && res.json().salesByDay.length === 14);
    void b;
  });

  it('audit trio: cashier forbidden, admin sees the trail', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/audit-logs', headers: auth(cash.token) })).statusCode, 403);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/audit-logs?pageSize=5', headers: auth(ctx.adminToken) });
    assert.equal(res.statusCode, 200);
    assert.ok(typeof res.json().total === 'number');
  });

  it('settings: readable by all roles, writable by ADMIN only, unknown keys rejected', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    const get = await ctx.app.inject({ method: 'GET', url: '/api/settings', headers: auth(cash.token) });
    assert.equal(get.statusCode, 200);
    assert.ok(get.json().settings['store.name']);
    const H = { 'content-type': 'application/json' };
    assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, ...auth(cash.token) }, payload: { settings: { 'store.name': 'X' } } })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, ...auth(ctx.adminToken) }, payload: { settings: { nope: 'X' } } })).statusCode, 400);
    assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/settings', headers: { ...H, ...auth(ctx.adminToken) }, payload: { settings: { 'store.phone': '+1 (555) 777-0000' } } })).statusCode, 200);
    const again = await ctx.app.inject({ method: 'GET', url: '/api/settings', headers: auth(cash.token) });
    assert.equal(again.json().settings['store.phone'], '+1 (555) 777-0000');
  });
});
