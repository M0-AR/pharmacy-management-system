import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';

export async function auditLog(opts: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: opts.actorId ?? null,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId ?? null,
        metadata: (opts.metadata ?? {}) as object,
        ip: opts.ip ?? null,
      },
    });
  } catch {
    // Audit must never break the main transaction path; log to stdout.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write', opts.action, opts.entity);
  }
}

export function requestIp(req: FastifyRequest): string | null {
  return (req.ip ?? req.headers['x-forwarded-for']?.toString().split(',')[0] ?? null) as string | null;
}

export function currentUserId(req: FastifyRequest): string | null {
  const u = (req as unknown as { user?: { sub?: string } }).user;
  return u?.sub ?? null;
}

export function sendError(reply: FastifyReply, status: number, message: string, details?: unknown) {
  return reply.status(status).send({ error: message, details: details ?? null });
}
