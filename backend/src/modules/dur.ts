import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { auditLog, currentUserId, requestIp } from '../lib/utils.js';

// DUR-lite clinical screening, designed from 2026 outpatient DUR evidence:
// - highest-value alerts are drug-allergy + duplicate therapy (time-boxed);
// - duplicate therapy uses a 120-day lookback (covers 90-day fills);
// - overrides require specific documented rationale, not a vague checkbox.
export interface DurWarning {
  type: 'drug-allergy' | 'duplicate-therapy' | 'same-class';
  severity: 'high' | 'medium';
  message: string;
  medicineId?: string;
}

const STOPWORDS = new Set([
  'allergy', 'allergies', 'allergic', 'drug', 'drugs', 'medication', 'medications',
  'medicine', 'medicines', 'severe', 'mild', 'known', 'history', 'with', 'and', 'or', 'to', 'of', 'the', 'a',
]);

function tokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export async function checkDur(customerId: string, medicineIds: string[]): Promise<DurWarning[]> {
  const [customer, meds] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.medicine.findMany({ where: { id: { in: medicineIds } } }),
  ]);
  if (!customer) throw new Error('Customer not found');
  const warnings: DurWarning[] = [];

  // 1) Drug-allergy screen against the patient profile.
  const allergyTokens = tokens(customer.allergies);
  const allergyRaw = (customer.allergies ?? '').trim();
  if (allergyTokens.length > 0 && allergyRaw) {
    for (const m of meds) {
      const medTokens = new Set([...tokens(m.name), ...tokens(m.genericName), ...tokens(m.brand), ...tokens(m.category)]);
      const hit = allergyTokens.find((a) =>
        [...medTokens].some((t) => (t.length >= 3 && a.length >= 3) && (t.includes(a) || a.includes(t))),
      );
      if (hit) {
        warnings.push({
          type: 'drug-allergy',
          severity: 'high',
          medicineId: m.id,
          message: `Possible allergy: profile reports "${allergyRaw}" — verify ${m.name}${m.genericName ? ` (${m.genericName})` : ''} before dispensing.`,
        });
      }
    }
  }

  // 2) Duplicate therapy / same-class screen over the last 120 days.
  const since = new Date();
  since.setDate(since.getDate() - 120);
  const history = await prisma.sale.findMany({
    where: { customerId, status: 'COMPLETED', createdAt: { gte: since } },
    include: { items: { include: { medicine: { select: { id: true, name: true, genericName: true, category: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  for (const m of meds) {
    for (const s of history) {
      for (const item of s.items) {
        const h = item.medicine;
        const sameGeneric =
          m.genericName && h.genericName && m.genericName.toLowerCase() === h.genericName.toLowerCase();
        const sameNameNoGeneric =
          !m.genericName && m.name.toLowerCase() === h.name.toLowerCase();
        if ((sameGeneric || sameNameNoGeneric) && !warnings.some((w) => w.medicineId === m.id && w.type === 'duplicate-therapy')) {
          warnings.push({
            type: 'duplicate-therapy',
            severity: 'high',
            medicineId: m.id,
            message: `Duplicate therapy: ${m.genericName ?? m.name} was dispensed ${s.createdAt.toISOString().slice(0, 10)} (${s.invoiceNo}). Confirm intentional refill/overlap.`,
          });
        } else if (
          !sameGeneric && !sameNameNoGeneric &&
          m.category && h.category && m.category.toLowerCase() === h.category.toLowerCase() &&
          h.id !== m.id &&
          !warnings.some((w) => w.medicineId === m.id && w.type === 'same-class')
        ) {
          warnings.push({
            type: 'same-class',
            severity: 'medium',
            medicineId: m.id,
            message: `Same class (${m.category}): ${h.name} dispensed ${s.createdAt.toISOString().slice(0, 10)}. Review for therapeutic duplication.`,
          });
        }
      }
    }
  }

  const rank = { high: 0, medium: 1 } as const;
  return warnings.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 20);
}

const checkSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(z.object({ medicineId: z.string().min(1) })).min(1).max(100),
});

const ackSchema = checkSchema.extend({
  warnings: z.array(z.object({ type: z.string(), severity: z.string(), message: z.string() })).max(50),
  note: z.string().max(500).optional().nullable(),
});

export async function durRoutes(app: FastifyInstance) {
  app.post('/dur/check', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    try {
      const warnings = await checkDur(parsed.data.customerId, parsed.data.items.map((i) => i.medicineId));
      return { warnings };
    } catch {
      return reply.status(400).send({ error: 'Customer not found' });
    }
  });

  app.post('/dur/acknowledge', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = ackSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const hasHigh = parsed.data.warnings.some((w) => w.severity === 'high');
    if (hasHigh && !(parsed.data.note ?? '').trim()) {
      return reply.status(400).send({ error: 'High-severity warnings require a documented clinical rationale (note).' });
    }
    await auditLog({
      actorId: currentUserId(req),
      action: 'dur.acknowledge',
      entity: 'Customer',
      entityId: parsed.data.customerId,
      metadata: {
        warnings: parsed.data.warnings,
        note: parsed.data.note ?? null,
        items: parsed.data.items,
      },
      ip: requestIp(req),
    });
    return { ok: true };
  });
}
