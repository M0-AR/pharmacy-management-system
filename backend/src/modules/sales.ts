import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { checkDur } from './dur.js';
import { requireAuth, requireRoles } from '../lib/auth.js';
import { auditLog, currentUserId, requestIp } from '../lib/utils.js';

const saleItemSchema = z.object({
  medicineId: z.string().min(1),
  qty: z.number().int().min(1).max(10000),
});

const saleSchema = z.object({
  customerId: z.string().optional().nullable(),
  items: z.array(saleItemSchema).min(1).max(100),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  taxPct: z.coerce.number().min(0).max(30).default(0),
  paymentMethod: z.enum(['CASH', 'CARD', 'INSURANCE']).default('CASH'),
  // Clinical safety: when the server-side DUR screen raises HIGH warnings, the
  // client must echo them back here as proof a pharmacist reviewed them.
  durAck: z
    .object({
      warnings: z.array(z.object({ type: z.string(), severity: z.string(), message: z.string() })).max(50),
      note: z.string().max(500).optional().nullable(),
    })
    .optional(),
});

const returnSchema = z.object({
  items: z.array(saleItemSchema).min(1).max(100),
  reason: z.string().min(3).max(300),
});

function nextInvoiceNo() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}${rand}`;
}

/** Net returned qty per medicine for a sale, derived from RETURN ledger rows. */
export async function returnedQtyByMedicine(saleId: string) {
  const rows = await prisma.stockMovement.findMany({ where: { refId: saleId, reason: 'RETURN' }, select: { medicineId: true, changeQty: true } });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.medicineId, (map.get(r.medicineId) ?? 0) + r.changeQty);
  return map;
}

const money = (n: number) => Math.round(n * 100) / 100;

export async function saleRoutes(app: FastifyInstance) {
  app.get('/sales', { preHandler: [requireAuth] }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize ?? 20) || 20));
    const status = (q.status ?? '').trim();
    const where = status === 'COMPLETED' || status === 'VOIDED' ? { status: status as 'COMPLETED' | 'VOIDED' } : {};
    const [total, sales] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          soldBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return {
      items: sales.map((s) => ({ ...s, subtotal: Number(s.subtotal), discountAmt: Number(s.discountAmt), taxAmt: Number(s.taxAmt), total: Number(s.total), discountPct: Number(s.discountPct), taxPct: Number(s.taxPct) })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.get('/sales/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        soldBy: { select: { id: true, name: true, email: true } },
        items: { include: { medicine: { select: { id: true, code: true, name: true, category: true } } } },
      },
    });
    if (!sale) return reply.status(404).send({ error: 'Sale not found' });
    const returned = await returnedQtyByMedicine(sale.id);
    const items = sale.items.map((i) => ({ ...i, unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) }));
    const refundedTotal =
      Math.round(items.reduce((s, i) => s + (Number(i.lineTotal) / i.qty) * (returned.get(i.medicineId) ?? 0), 0) * 100) / 100;
    return {
      sale: {
        ...sale,
        subtotal: Number(sale.subtotal),
        discountAmt: Number(sale.discountAmt),
        discountPct: Number(sale.discountPct),
        taxAmt: Number(sale.taxAmt),
        taxPct: Number(sale.taxPct),
        total: Number(sale.total),
        items,
        returns: [...returned.entries()].map(([medicineId, qty]) => ({ medicineId, qty })),
        refundedTotal,
      },
    };
  });

  app.post('/sales', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = saleSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const { customerId, items, discountPct, taxPct, paymentMethod, durAck } = parsed.data;
    const role = (req.user as { role: string }).role;

    if (customerId) {
      const c = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!c) return reply.status(400).send({ error: 'Customer not found' });
    }

    const ids = [...new Set(items.map((i) => i.medicineId))];
    const meds = await prisma.medicine.findMany({ where: { id: { in: ids } } });
    const byId = new Map(meds.map((m) => [m.id, m]));
    for (const line of items) {
      const m = byId.get(line.medicineId);
      if (!m) return reply.status(400).send({ error: `Medicine not found: ${line.medicineId}` });
      if (m.expiryDate && new Date(m.expiryDate) < new Date()) {
        return reply.status(400).send({ error: `Cannot sell expired medicine: ${m.name}` });
      }
      if (m.quantity < line.qty) {
        return reply.status(400).send({ error: `Insufficient stock for ${m.name}: have ${m.quantity}, need ${line.qty}` });
      }
    }

    // Verify-Before-Dispense gate: Rx lines require a pharmacist's session.
    const hasRx = [...byId.values()].some((m) => m.rxType === 'RX');
    if (hasRx && !['ADMIN', 'PHARMACIST'].includes(role)) {
      return reply.status(403).send({ error: 'Pharmacist verification required: this sale contains prescription (Rx) items.' });
    }

    // Server-side DUR screen: HIGH warnings must come back acknowledged.
    if (customerId) {
      const live = await checkDur(customerId, ids);
      const high = live.filter((w) => w.severity === 'high');
      if (high.length > 0) {
        const acked = new Set((durAck?.warnings ?? []).map((w) => `${w.type}|${w.message}`));
        const missing = high.filter((w) => !acked.has(`${w.type}|${w.message}`));
        if (missing.length > 0) {
          return reply.status(409).send({ error: 'Clinical review required before dispensing', warnings: missing });
        }
      }
    }

    let subtotal = 0;
    const lines = items.map((line) => {
      const m = byId.get(line.medicineId)!;
      const unit = Number(m.unitPrice);
      const lineTotal = money(unit * line.qty);
      subtotal += lineTotal;
      return { medicineId: m.id, qty: line.qty, unitPrice: unit, lineTotal };
    });
    subtotal = money(subtotal);
    const discountAmt = money((subtotal * discountPct) / 100);
    const taxable = money(subtotal - discountAmt);
    const taxAmt = money((taxable * taxPct) / 100);
    const total = money(taxable + taxAmt);

    let sale: { id: string; invoiceNo: string; subtotal: unknown; total: unknown } | null = null;
    let invoiceNo = '';
    for (let attempt = 0; attempt < 3 && !sale; attempt++) {
      invoiceNo = nextInvoiceNo();
      try {
        sale = await prisma.$transaction(async (tx) => {
          const created = await tx.sale.create({
            data: {
              invoiceNo,
              customerId: customerId || null,
              subtotal,
              discountPct,
              discountAmt,
              taxPct,
              taxAmt,
              total,
              paymentMethod,
              status: 'COMPLETED',
              soldById: currentUserId(req),
              items: { create: lines },
            },
          });
          for (const line of lines) {
            await tx.medicine.update({ where: { id: line.medicineId }, data: { quantity: { decrement: line.qty } } });
            await tx.stockMovement.create({
              data: { medicineId: line.medicineId, changeQty: -line.qty, reason: 'SALE', refId: created.id, note: invoiceNo, createdById: currentUserId(req) },
            });
          }
          return created;
        });
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002' && attempt < 2) continue;
        throw e;
      }
    }
    if (!sale) return reply.status(500).send({ error: 'Could not complete sale, please retry' });

    await auditLog({
      actorId: currentUserId(req),
      action: 'sale.create',
      entity: 'Sale',
      entityId: sale.id,
      metadata: { invoiceNo, total, hasRx, durAcked: durAck?.warnings?.length ?? 0, durNote: durAck?.note ?? null },
      ip: requestIp(req),
    });
    return reply.status(201).send({ sale: { ...sale, subtotal: Number(sale.subtotal as number), total: Number(sale.total as number) }, invoiceNo });
  });

  app.post(
    '/sales/:id/void',
    { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
      if (!sale) return reply.status(404).send({ error: 'Sale not found' });
      if (sale.status === 'VOIDED') return reply.status(400).send({ error: 'Sale already voided' });
      await prisma.$transaction(async (tx) => {
        await tx.sale.update({ where: { id }, data: { status: 'VOIDED' } });
        for (const line of sale.items) {
          await tx.medicine.update({ where: { id: line.medicineId }, data: { quantity: { increment: line.qty } } });
          await tx.stockMovement.create({
            data: { medicineId: line.medicineId, changeQty: line.qty, reason: 'RETURN', refId: id, note: `Void ${sale.invoiceNo}`, createdById: currentUserId(req) },
          });
        }
      });
      await auditLog({ actorId: currentUserId(req), action: 'sale.void', entity: 'Sale', entityId: id, ip: requestIp(req) });
      return { ok: true };
    },
  );

  // Partial returns: restock selected lines with a RETURN ledger trail.
  // Returned qty can never exceed (sold − already returned) per medicine.
  app.post(
    '/sales/:id/returns',
    { preHandler: [requireAuth, requireRoles('ADMIN', 'PHARMACIST')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = returnSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      const sale = await prisma.sale.findUnique({ where: { id }, include: { items: { include: { medicine: true } } } });
      if (!sale) return reply.status(404).send({ error: 'Sale not found' });
      if (sale.status === 'VOIDED') return reply.status(400).send({ error: 'Sale is voided — nothing to return' });

      const returned = await returnedQtyByMedicine(id);
      const wanted = new Map<string, number>();
      for (const l of parsed.data.items) wanted.set(l.medicineId, (wanted.get(l.medicineId) ?? 0) + l.qty);
      for (const [medicineId, qty] of wanted) {
        const line = sale.items.find((i) => i.medicineId === medicineId);
        if (!line) return reply.status(400).send({ error: 'Item was not part of this sale' });
        const already = returned.get(medicineId) ?? 0;
        if (qty <= 0 || line.qty - already < qty) {
          return reply.status(400).send({ error: `Cannot return ${qty} × ${line.medicine.name}: only ${line.qty - already} returnable` });
        }
      }

      await prisma.$transaction(async (tx) => {
        for (const [medicineId, qty] of wanted) {
          await tx.medicine.update({ where: { id: medicineId }, data: { quantity: { increment: qty } } });
          await tx.stockMovement.create({
            data: { medicineId, changeQty: qty, reason: 'RETURN', refId: id, note: `${parsed.data.reason} (${sale.invoiceNo})`, createdById: currentUserId(req) },
          });
        }
      });
      await auditLog({
        actorId: currentUserId(req),
        action: 'sale.return',
        entity: 'Sale',
        entityId: id,
        metadata: { reason: parsed.data.reason, items: [...wanted.entries()].map(([medicineId, qty]) => ({ medicineId, qty })) },
        ip: requestIp(req),
      });
      return { ok: true };
    },
  );

  app.get('/sales/:id/returns', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const returned = await returnedQtyByMedicine(id);
    return { returns: [...returned.entries()].map(([medicineId, qty]) => ({ medicineId, qty })) };
  });
}
