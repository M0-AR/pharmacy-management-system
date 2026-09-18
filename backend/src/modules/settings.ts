import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth, requireRoles } from '../lib/auth.js';
import { auditLog, currentUserId, requestIp } from '../lib/utils.js';

export const SETTING_DEFAULTS: Record<string, string> = {
  'store.name': 'PharmaSuite Pharmacy',
  'store.tagline': 'Eastern USA · Rx + OTC',
  'store.address': 'Philadelphia, PA',
  'store.phone': '+1 (555) 010-2000',
  'store.receiptFooter': 'Thank you for your trust. Check expiry before use · Ask your pharmacist about interactions.',
};

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', { preHandler: [requireAuth] }, async () => {
    const rows = await prisma.setting.findMany();
    const map: Record<string, string> = { ...SETTING_DEFAULTS };
    for (const r of rows) map[r.key] = r.value;
    return { settings: map };
  });

  const putSchema = z.object({
    settings: z.record(z.string().min(1).max(60), z.string().max(300)).refine((o) => Object.keys(o).length <= 20, 'Too many keys'),
  });

  app.put(
    '/settings',
    { preHandler: [requireAuth, requireRoles('ADMIN')] },
    async (req, reply) => {
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
      const allowed = new Set(Object.keys(SETTING_DEFAULTS));
      for (const key of Object.keys(parsed.data.settings)) {
        if (!allowed.has(key)) return reply.status(400).send({ error: `Unknown setting: ${key}` });
      }
      await prisma.$transaction(
        Object.entries(parsed.data.settings).map(([key, value]) =>
          prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }),
        ),
      );
      await auditLog({ actorId: currentUserId(req), action: 'settings.update', entity: 'Setting', metadata: { keys: Object.keys(parsed.data.settings) }, ip: requestIp(req) });
      return { ok: true };
    },
  );
}
