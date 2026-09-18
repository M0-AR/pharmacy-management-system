/**
 * Shared integration-test infrastructure (2026 consensus):
 * - real PostgreSQL test database (TEST_DATABASE_URL), migrated in tests/setup.ts
 * - Fastify app exercised via inject() — no ports, no conflicts
 * - FK-safe truncate before every file for full isolation
 * - data factories with unique values so files never collide
 */
import { after, before } from 'node:test';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db.js';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

let n = 0;
export function uid(prefix = 't'): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function truncateAll() {
  // FK-safe order: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.user.deleteMany();
}

export interface Ctx {
  app: FastifyInstance;
  admin: { id: string; email: string; role: string };
  adminToken: string;
}

/** Build a fresh app + pristine DB + seeded ADMIN. Call from before(). */
export async function setupCtx(): Promise<Ctx> {
  const app = await buildApp();
  await truncateAll();
  const email = `${uid('admin')}@example.com`;
  const admin = await prisma.user.create({
    data: { name: 'Test Admin', email, passwordHash: await bcrypt.hash('Admin12345!', 4), role: 'ADMIN', active: true },
  });
  const adminToken = app.jwt.sign({ sub: admin.id, email: admin.email, role: 'ADMIN', name: admin.name });
  return { app, admin: { id: admin.id, email: admin.email, role: 'ADMIN' }, adminToken };
}

export async function teardownCtx(ctx: Ctx) {
  await ctx.app.close();
  await prisma.$disconnect();
}

export function reg(ctx: Ctx, setup: () => Promise<unknown>, teardown: () => Promise<unknown>) {
  before(setup);
  after(teardown);
}

export async function createUser(
  app: FastifyInstance,
  overrides: { role?: 'ADMIN' | 'PHARMACIST' | 'TECHNICIAN' | 'CASHIER'; password?: string; active?: boolean } = {},
) {
  const email = `${uid('user')}@example.com`;
  const password = overrides.password ?? 'Password123!';
  const user = await prisma.user.create({
    data: {
      name: 'Test User',
      email,
      passwordHash: await bcrypt.hash(password, 4),
      role: overrides.role ?? 'CASHIER',
      active: overrides.active ?? true,
    },
  });
  const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name });
  return { user, token, password, email };
}

export async function createMedicine(overrides: Record<string, unknown> = {}) {
  return prisma.medicine.create({
    data: {
      code: `T-${uid('med').slice(-8).toUpperCase()}`,
      name: `Testmed ${uid('m')}`,
      category: 'Tablets',
      rxType: 'OTC',
      unitPrice: 9.99,
      quantity: 100,
      lowStockThreshold: 10,
      ...overrides,
    } as never,
  });
}

export async function createCustomer(overrides: Record<string, unknown> = {}) {
  const u = uid('c');
  return prisma.customer.create({
    data: { firstName: 'Test', lastName: `Patient ${u}`, ...overrides } as never,
  });
}

export async function createSupplier(overrides: Record<string, unknown> = {}) {
  return prisma.supplier.create({ data: { name: `Supplier ${uid('s')}`, ...overrides } as never });
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export function json(res: { body: string }) {
  return JSON.parse(res.body) as Record<string, unknown>;
}
