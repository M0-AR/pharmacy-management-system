import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupCtx, teardownCtx, type Ctx } from './helpers.js';

describe('platform health & hardening', () => {
  let ctx: Ctx;
  before(async () => { ctx = await setupCtx(); });
  after(async () => { await teardownCtx(ctx); });

  it('GET /health reports up', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });

  it('GET /ready confirms database connectivity', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ready, true);
  });

  it('sends security headers (helmet)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-frame-options']);
  });

  it('unknown routes 404', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    assert.equal(res.statusCode, 404);
  });

  it('rejects malformed JSON login payloads', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { 'content-type': 'application/json' }, payload: { email: 'not-an-email' },
    });
    assert.equal(res.statusCode, 400);
  });
});
