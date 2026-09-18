import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth, requireRoles } from '../lib/auth.js';
import { auditLog, currentUserId, requestIp } from '../lib/utils.js';

const customerSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().max(32).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().max(300).optional().nullable(),
  dateOfBirth: z.preprocess(
    (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v),
    z.string().datetime().optional().nullable().or(z.literal('')),
  ),
  allergies: z.string().max(500).optional().nullable(),
  insuranceProvider: z.string().max(120).optional().nullable(),
});

const supplierSchema = z.object({
  name: z.string().min(2).max(120),
  contactName: z.string().max(120).optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().max(300).optional().nullable(),
});

export async function customerRoutes(app: FastifyInstance) {
  app.get('/customers', { preHandler: [requireAuth] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const search = (q.search ?? '').trim();
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 25) || 25));
    const where = search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [total, items] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { sales: true } } },
      }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  app.post('/customers', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const d = parsed.data;
    const created = await prisma.customer.create({
      data: {
        firstName: d.firstName.trim(),
        lastName: d.lastName.trim(),
        phone: d.phone?.trim() || null,
        email: d.email?.trim() || null,
        address: d.address?.trim() || null,
        dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null,
        allergies: d.allergies?.trim() || null,
        insuranceProvider: d.insuranceProvider?.trim() || null,
      },
    });
    await auditLog({ actorId: currentUserId(req), action: 'customer.create', entity: 'Customer', entityId: created.id, ip: requestIp(req) });
    return reply.status(201).send({ customer: created });
  });

  app.put('/customers/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = customerSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const updated = await prisma.customer.update({
        where: { id },
        data: {
          ...(d.firstName !== undefined ? { firstName: d.firstName.trim() } : {}),
          ...(d.lastName !== undefined ? { lastName: d.lastName.trim() } : {}),
          ...(d.phone !== undefined ? { phone: d.phone?.trim() || null } : {}),
          ...(d.email !== undefined ? { email: d.email?.trim() || null } : {}),
          ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
          ...(d.dateOfBirth !== undefined ? { dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth as string) : null } : {}),
          ...(d.allergies !== undefined ? { allergies: d.allergies?.trim() || null } : {}),
          ...(d.insuranceProvider !== undefined ? { insuranceProvider: d.insuranceProvider?.trim() || null } : {}),
        },
      });
      await auditLog({ actorId: currentUserId(req), action: 'customer.update', entity: 'Customer', entityId: id, ip: requestIp(req) });
      return { customer: updated };
    } catch {
      return reply.status(404).send({ error: 'Customer not found' });
    }
  });

  app.delete('/customers/:id', { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sales = await prisma.sale.count({ where: { customerId: id } });
    if (sales > 0) return reply.status(409).send({ error: 'Cannot delete: customer has sales history.' });
    await prisma.customer.delete({ where: { id } });
    await auditLog({ actorId: currentUserId(req), action: 'customer.delete', entity: 'Customer', entityId: id, ip: requestIp(req) });
    return { ok: true };
  });

  app.get('/customers/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { sales: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });
    return { customer: { ...customer, sales: customer.sales.map((s) => ({ ...s, subtotal: Number(s.subtotal), total: Number(s.total) })) } };
  });
}

export async function supplierRoutes(app: FastifyInstance) {
  app.get('/suppliers', { preHandler: [requireAuth] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const search = (q.search ?? '').trim();
    const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
    const items = await prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { medicines: true } } },
      take: 200,
    });
    return { items, total: items.length };
  });

  app.post('/suppliers', { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] }, async (req, reply) => {
    const parsed = supplierSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const d = parsed.data;
    const created = await prisma.supplier.create({
      data: { name: d.name.trim(), contactName: d.contactName?.trim() || null, phone: d.phone?.trim() || null, email: d.email?.trim() || null, address: d.address?.trim() || null },
    });
    await auditLog({ actorId: currentUserId(req), action: 'supplier.create', entity: 'Supplier', entityId: created.id, ip: requestIp(req) });
    return reply.status(201).send({ supplier: created });
  });

  app.put('/suppliers/:id', { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = supplierSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const d = parsed.data;
    try {
      const updated = await prisma.supplier.update({
        where: { id },
        data: {
          ...(d.name !== undefined ? { name: d.name.trim() } : {}),
          ...(d.contactName !== undefined ? { contactName: d.contactName?.trim() || null } : {}),
          ...(d.phone !== undefined ? { phone: d.phone?.trim() || null } : {}),
          ...(d.email !== undefined ? { email: d.email?.trim() || null } : {}),
          ...(d.address !== undefined ? { address: d.address?.trim() || null } : {}),
        },
      });
      await auditLog({ actorId: currentUserId(req), action: 'supplier.update', entity: 'Supplier', entityId: id, ip: requestIp(req) });
      return { supplier: updated };
    } catch {
      return reply.status(404).send({ error: 'Supplier not found' });
    }
  });

  app.delete('/suppliers/:id', { preHandler: [requireAuth, requireRoles('ADMIN')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.medicine.updateMany({ where: { supplierId: id }, data: { supplierId: null } });
    await prisma.supplier.delete({ where: { id } });
    await auditLog({ actorId: currentUserId(req), action: 'supplier.delete', entity: 'Supplier', entityId: id, ip: requestIp(req) });
    return { ok: true };
  });
}
