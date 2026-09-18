import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auth, createUser, setupCtx, teardownCtx, type Ctx } from './helpers.js';

const H = { 'content-type': 'application/json' };

describe('auth & users', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('logs in with valid credentials and leaks no password hash', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: ctx.admin.email, password: 'Admin12345!' } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().token);
    assert.equal(res.json().user.role, 'ADMIN');
    assert.ok(!('passwordHash' in res.json().user));
  });

  it('rejects wrong password, unknown email, and disabled accounts', async () => {
    const { user, password } = await createUser(ctx.app, { active: false });
    for (const payload of [
      { email: ctx.admin.email, password: 'wrong' },
      { email: 'nobody@example.com', password: 'whatever123' },
      { email: user.email, password },
    ]) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload });
      assert.equal(res.statusCode, 401);
    }
  });

  it('auth trio on GET /api/users: 401 anonymous, 403 cashier, 200 admin', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/users' })).statusCode, 401);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/users', headers: auth(cash.token) })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/users', headers: auth(ctx.adminToken) })).statusCode, 200);
  });

  it('only ADMIN can create users; validates input; blocks duplicates', async () => {
    const cash = await createUser(ctx.app, { role: 'CASHIER' });
    const payload = { name: 'New Hire', email: 'hire@example.com', password: 'Hire12345!', role: 'TECHNICIAN' };
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/users', headers: { ...H, ...auth(cash.token) }, payload })).statusCode, 403);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/users', headers: { ...H, ...auth(ctx.adminToken) }, payload: { ...payload, password: 'short' } })).statusCode, 400);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/users', headers: { ...H, ...auth(ctx.adminToken) }, payload })).statusCode, 201);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/users', headers: { ...H, ...auth(ctx.adminToken) }, payload })).statusCode, 409);
  });

  it('deactivation guards: self and last-admin are protected', async () => {
    const other = await createUser(ctx.app, { role: 'CASHIER' });
    // self-deactivate
    assert.equal((await ctx.app.inject({ method: 'PATCH', url: `/api/users/${ctx.admin.id}`, headers: { ...H, ...auth(ctx.adminToken) }, payload: { active: false } })).statusCode, 400);
    // deactivate other, then prove login fails, then reactivate
    assert.equal((await ctx.app.inject({ method: 'PATCH', url: `/api/users/${other.user.id}`, headers: { ...H, ...auth(ctx.adminToken) }, payload: { active: false } })).statusCode, 200);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: other.email, password: other.password } })).statusCode, 401);
    // last-admin guard: create second admin, deactivate first, then second refuses
    const a2 = await ctx.app.inject({ method: 'POST', url: '/api/users', headers: { ...H, ...auth(ctx.adminToken) }, payload: { name: 'A2', email: 'a2@example.com', password: 'A212345678!', role: 'ADMIN' } });
    const a2id = a2.json().user.id as string;
    const a2login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'a2@example.com', password: 'A212345678!' } });
    const a2token = a2login.json().token as string;
    assert.equal((await ctx.app.inject({ method: 'PATCH', url: `/api/users/${ctx.admin.id}`, headers: { ...H, ...auth(a2token) }, payload: { active: false } })).statusCode, 200);
    assert.equal((await ctx.app.inject({ method: 'PATCH', url: `/api/users/${a2id}`, headers: { ...H, ...auth(a2token) }, payload: { active: false } })).statusCode, 400);
    assert.equal((await ctx.app.inject({ method: 'PATCH', url: `/api/users/${ctx.admin.id}`, headers: { ...H, ...auth(a2token) }, payload: { active: true } })).statusCode, 200);
  });

  it('password change requires the current password and takes effect', async () => {
    const u = await createUser(ctx.app, { role: 'TECHNICIAN' });
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...H, ...auth(u.token) }, payload: { currentPassword: 'nope', newPassword: 'BrandNew123!' } });
    assert.equal(bad.statusCode, 400);
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...H, ...auth(u.token) }, payload: { currentPassword: u.password, newPassword: 'BrandNew123!' } });
    assert.equal(ok.statusCode, 200);
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: u.email, password: 'BrandNew123!' } });
    assert.equal(login.statusCode, 200);
  });
});
