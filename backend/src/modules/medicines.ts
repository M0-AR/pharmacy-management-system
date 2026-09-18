import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { requireAuth, requireRoles } from '../lib/auth.js';
import { auditLog, currentUserId, requestIp } from '../lib/utils.js';

const medicineSchema = z.object({
  name: z.string().min(2).max(120),
  genericName: z.string().max(120).optional().nullable(),
  brand: z.string().max(120).optional().nullable(),
  category: z.string().max(80).default('General'),
  ndc: z.string().max(32).optional().nullable(),
  rxType: z.enum(['RX', 'OTC']).default('OTC'),
  unitPrice: z.coerce.number().min(0).max(100000),
  quantity: z.coerce.number().int().min(0).max(1000000).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).max(10000).default(10),
  // Accepts full ISO datetimes AND date-picker YYYY-MM-DD (normalized to UTC midnight).
  expiryDate: z.preprocess(
    (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v),
    z.string().datetime().optional().nullable().or(z.literal('')),
  ),
  supplierId: z.string().optional().nullable(),
});

const adjustSchema = z.object({
  changeQty: z.number().int().min(-1000000).max(1000000).refine((v) => v !== 0, 'changeQty cannot be 0'),
  reason: z.enum(['PURCHASE', 'ADJUSTMENT', 'EXPIRED', 'RETURN', 'SALE']).default('ADJUSTMENT'),
  note: z.string().max(300).optional().nullable(),
});

function nextCode() {
  // Random 5-digit code; callers retry on unique collision (P2002).
  return `MED-${Math.floor(10000 + Math.random() * 89999)}`;
}

async function createMedicineUnique(data: Omit<Prisma.MedicineUncheckedCreateInput, 'id' | 'code' | 'createdAt' | 'updatedAt'>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.medicine.create({ data: { ...data, code: nextCode() } });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002' && attempt < 4) continue;
      throw e;
    }
  }
  throw new Error('Could not allocate a unique medicine code');
}

export async function medicineRoutes(app: FastifyInstance) {
  app.get('/medicines', { preHandler: [requireAuth] }, async (req) => {
    const q = (req.query as Record<string, string | undefined>);
    const search = (q.search ?? '').trim();
    const category = (q.category ?? '').trim();
    const stock = (q.stock ?? 'all').trim(); // all | low | out | expired
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 25) || 25));
    const where: Record<string, unknown> = {};
    if (search) {
      (where as { OR: unknown[] }).OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { ndc: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category && category !== 'all') (where as Record<string, unknown>).category = category;
    if (stock === 'out') (where as Record<string, unknown>).quantity = 0;
    if (stock === 'expired') (where as Record<string, unknown>).expiryDate = { lt: new Date() };

    // Low-stock is per-medicine (quantity <= that row's lowStockThreshold), which
    // Prisma cannot express as a column comparison — page IDs with SQL, hydrate with Prisma.
    if (stock === 'low') {
      const like = `%${search.replace(/[%_]/g, '')}%`;
      const conds: Prisma.Sql[] = [Prisma.sql`m.quantity <= m."lowStockThreshold"`];
      if (search) {
        conds.push(Prisma.sql`(m.name ILIKE ${like} OR m."genericName" ILIKE ${like} OR m.brand ILIKE ${like} OR m.code ILIKE ${like} OR m.ndc ILIKE ${like})`);
      }
      if (category && category !== 'all') conds.push(Prisma.sql`m.category = ${category}`);
      const whereSql = Prisma.join(conds, ' AND ');
      const totalRows = await prisma.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "Medicine" m WHERE ${whereSql}`,
      );
      const total = Number(totalRows[0]?.count ?? 0);
      const idRows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT m.id FROM "Medicine" m WHERE ${whereSql} ORDER BY m."updatedAt" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      );
      const ids = idRows.map((r) => r.id);
      const found = ids.length
        ? await prisma.medicine.findMany({ where: { id: { in: ids } }, include: { supplier: { select: { id: true, name: true } } } })
        : [];
      const byId = new Map(found.map((m) => [m.id, m]));
      const items = ids.map((id) => byId.get(id)).filter((m): m is (typeof found)[number] => Boolean(m));
      const categories = await prisma.medicine.groupBy({ by: ['category'], _count: { category: true }, orderBy: { category: 'asc' } });
      return {
        items: items.map((m) => ({
          ...m,
          unitPrice: Number(m.unitPrice),
          lowStock: m.quantity <= m.lowStockThreshold,
          expired: m.expiryDate ? new Date(m.expiryDate) < new Date() : false,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        categories: categories.map((c) => c.category),
      };
    }

    const [total, items, categories] = await Promise.all([
      prisma.medicine.count({ where: where as never }),
      prisma.medicine.findMany({
        where: where as never,
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.medicine.groupBy({ by: ['category'], _count: { category: true }, orderBy: { category: 'asc' } }),
    ]);
    return {
      items: items.map((m) => ({
        ...m,
        unitPrice: Number(m.unitPrice),
        lowStock: m.quantity <= m.lowStockThreshold,
        expired: m.expiryDate ? new Date(m.expiryDate) < new Date() : false,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      categories: categories.map((c) => c.category),
    };
  });

  app.get('/medicines/low-stock', { preHandler: [requireAuth] }, async () => {
    const items = await prisma.medicine.findMany({ orderBy: { quantity: 'asc' }, take: 100 });
    const low = items.filter((m) => m.quantity <= m.lowStockThreshold);
    return { items: low.map((m) => ({ ...m, unitPrice: Number(m.unitPrice) })), count: low.length };
  });

  app.get('/medicines/expired', { preHandler: [requireAuth] }, async () => {
    const items = await prisma.medicine.findMany({
      where: { expiryDate: { lt: new Date() } },
      orderBy: { expiryDate: 'asc' },
      take: 100,
    });
    return { items: items.map((m) => ({ ...m, unitPrice: Number(m.unitPrice) })), count: items.length };
  });

  app.get('/medicines/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await prisma.medicine.findUnique({ where: { id }, include: { supplier: true } });
    if (!m) return reply.status(404).send({ error: 'Medicine not found' });
    return { medicine: { ...m, unitPrice: Number(m.unitPrice) } };
  });

  app.post(
    '/medicines',
    { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST', 'TECHNICIAN')] },
    async (req, reply) => {
      const parsed = medicineSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      const d = parsed.data;
      const created = await createMedicineUnique({
        name: d.name.trim(),
        genericName: d.genericName?.trim() || null,
        brand: d.brand?.trim() || null,
        category: d.category.trim() || 'General',
        ndc: d.ndc?.trim() || null,
        rxType: d.rxType,
        unitPrice: d.unitPrice,
        quantity: d.quantity,
        lowStockThreshold: d.lowStockThreshold,
        expiryDate: d.expiryDate ? new Date(d.expiryDate) : null,
        supplierId: d.supplierId || null,
      });
      if (d.quantity > 0) {
        await prisma.stockMovement.create({
          data: { medicineId: created.id, changeQty: d.quantity, reason: 'PURCHASE', note: 'Opening stock', createdById: currentUserId(req) },
        });
      }
      await auditLog({ actorId: currentUserId(req), action: 'medicine.create', entity: 'Medicine', entityId: created.id, metadata: { name: created.name }, ip: requestIp(req) });
      return reply.status(201).send({ medicine: { ...created, unitPrice: Number(created.unitPrice) } });
    },
  );

  app.put(
    '/medicines/:id',
    { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST', 'TECHNICIAN')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = medicineSchema.partial().safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      const d = parsed.data;
      const existing = await prisma.medicine.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Medicine not found' });
      // Ledger integrity: a quantity change here is a stock correction and must
      // leave a movement trail, exactly like /adjust does.
      const qtyDelta =
        d.quantity !== undefined && d.quantity !== existing.quantity ? d.quantity - existing.quantity : 0;
      const updated = await prisma.$transaction(async (tx) => {
        const m = await tx.medicine.update({
          where: { id },
          data: {
            ...(d.name !== undefined ? { name: d.name.trim() } : {}),
            ...(d.genericName !== undefined ? { genericName: d.genericName?.trim() || null } : {}),
            ...(d.brand !== undefined ? { brand: d.brand?.trim() || null } : {}),
            ...(d.category !== undefined ? { category: d.category.trim() || 'General' } : {}),
            ...(d.ndc !== undefined ? { ndc: d.ndc?.trim() || null } : {}),
            ...(d.rxType !== undefined ? { rxType: d.rxType } : {}),
            ...(d.unitPrice !== undefined ? { unitPrice: d.unitPrice } : {}),
            ...(d.quantity !== undefined ? { quantity: d.quantity } : {}),
            ...(d.lowStockThreshold !== undefined ? { lowStockThreshold: d.lowStockThreshold } : {}),
            ...(d.expiryDate !== undefined ? { expiryDate: d.expiryDate ? new Date(d.expiryDate as string) : null } : {}),
            ...(d.supplierId !== undefined ? { supplierId: d.supplierId || null } : {}),
          },
        });
        if (qtyDelta !== 0) {
          await tx.stockMovement.create({
            data: {
              medicineId: id,
              changeQty: qtyDelta,
              reason: 'ADJUSTMENT',
              note: `Manual correction via medicine edit (${existing.quantity} → ${m.quantity})`,
              createdById: currentUserId(req),
            },
          });
        }
        return m;
      });
      await auditLog({ actorId: currentUserId(req), action: 'medicine.update', entity: 'Medicine', entityId: id, metadata: qtyDelta !== 0 ? { qtyDelta } : undefined, ip: requestIp(req) });
      return { medicine: { ...updated, unitPrice: Number(updated.unitPrice) } };
    },
  );

  app.post(
    '/medicines/:id/adjust',
    { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST', 'TECHNICIAN')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = adjustSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      const med = await prisma.medicine.findUnique({ where: { id } });
      if (!med) return reply.status(404).send({ error: 'Medicine not found' });
      const nextQty = med.quantity + parsed.data.changeQty;
      if (nextQty < 0) return reply.status(400).send({ error: 'Insufficient stock: cannot go below zero' });
      const [updated] = await prisma.$transaction([
        prisma.medicine.update({ where: { id }, data: { quantity: nextQty } }),
        prisma.stockMovement.create({
          data: {
            medicineId: id,
            changeQty: parsed.data.changeQty,
            reason: parsed.data.reason,
            note: parsed.data.note || null,
            createdById: currentUserId(req),
          },
        }),
      ]);
      await auditLog({ actorId: currentUserId(req), action: 'medicine.adjust', entity: 'Medicine', entityId: id, metadata: { changeQty: parsed.data.changeQty, reason: parsed.data.reason }, ip: requestIp(req) });
      return { medicine: { ...updated, unitPrice: Number(updated.unitPrice) } };
    },
  );

  app.delete(
    '/medicines/:id',
    { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const used = await prisma.saleItem.count({ where: { medicineId: id } });
      if (used > 0) return reply.status(409).send({ error: 'Cannot delete: medicine has sales history. Set quantity to 0 instead.' });
      await prisma.stockMovement.deleteMany({ where: { medicineId: id } });
      await prisma.medicine.delete({ where: { id } });
      await auditLog({ actorId: currentUserId(req), action: 'medicine.delete', entity: 'Medicine', entityId: id, ip: requestIp(req) });
      return { ok: true };
    },
  );

  app.get('/medicines/:id/movements', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const items = await prisma.stockMovement.findMany({
      where: { medicineId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return { items };
  });
}
