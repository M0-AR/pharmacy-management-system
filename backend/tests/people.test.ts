import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db.js';
import { auth, createCustomer, createMedicine, createSupplier, createUser, setupCtx, teardownCtx, type Ctx } from './helpers.js';

const H = { 'content-type': 'application/json' };

describe('customers & suppliers', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('customer CRUD with validation; delete blocked by sales history', async () => {
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/customers', headers: { ...H, ...auth(ctx.adminToken) }, payload: { firstName: '', lastName: 'X' } });
    assert.equal(bad.statusCode, 400);
    const created = await ctx.app.inject({ method: 'POST', url: '/api/customers', headers: { ...H, ...auth(ctx.adminToken) }, payload: { firstName: 'Del', lastName: 'Me', phone: '+1 (555) 000-0000' } });
    assert.equal(created.statusCode, 201);
    const id = created.json().customer.id as string;
    assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/customers/${id}`, headers: { ...H, ...auth(ctx.adminToken) }, payload: { phone: '+1 (555) 111-1111' } })).statusCode, 200);
    // With history → 409; without → 200.
    const withSales = await createCustomer({});
    const med = await createMedicine({ quantity: 5 });
    await prisma.sale.create({
      data: {
        invoiceNo: `INV-c-${Date.now()}`, subtotal: 5, total: 5, paymentMethod: 'CASH', customerId: withSales.id,
        soldById: ctx.admin.id, items: { create: [{ medicineId: med.id, qty: 1, unitPrice: 5, lineTotal: 5 }] },
      },
    });
    assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/customers/${withSales.id}`, headers: auth(ctx.adminToken) })).statusCode, 409);
    assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/customers/${id}`, headers: auth(ctx.adminToken) })).statusCode, 200);
  });

  it('customer detail embeds recent sales', async () => {
    const cust = await createCustomer({});
    const med = await createMedicine({ quantity: 5 });
    await prisma.sale.create({
      data: {
        invoiceNo: `INV-d-${Date.now()}`, subtotal: 5, total: 5, paymentMethod: 'CASH', customerId: cust.id,
        soldById: ctx.admin.id, items: { create: [{ medicineId: med.id, qty: 1, unitPrice: 5, lineTotal: 5 }] },
      },
    });
    const res = await ctx.app.inject({ method: 'GET', url: `/api/customers/${cust.id}`, headers: auth(ctx.adminToken) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().customer.sales.length, 1);
  });

  it('supplier CRUD with roles; delete unlinks medicines instead of orphaning', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/suppliers', headers: { ...H, ...auth(cash.token) }, payload: { name: 'Nope' } })).statusCode, 403);
    const created = await ctx.app.inject({ method: 'POST', url: '/api/suppliers', headers: { ...H, ...auth(ctx.adminToken) }, payload: { name: ' unlink me', contactName: 'Rep' } });
    assert.equal(created.statusCode, 201);
    const sid = created.json().supplier.id as string;
    const med = await createMedicine({ supplierId: sid });
    assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/suppliers/${sid}`, headers: auth(cash.token) })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/suppliers/${sid}`, headers: auth(ctx.adminToken) })).statusCode, 200);
    assert.equal((await prisma.medicine.findUniqueOrThrow({ where: { id: med.id } })).supplierId, null);
  });
});
