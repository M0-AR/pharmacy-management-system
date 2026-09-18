import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: string; name: string };
    user: { sub: string; email: string; role: string; name: string };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    if (!(req.user as { sub?: string })?.sub) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const dbUser = await prisma.user.findUnique({
      where: { id: (req.user as { sub: string }).sub },
      select: { id: true, active: true },
    });
    if (!dbUser || !dbUser.active) {
      return reply.status(401).send({ error: 'Account disabled' });
    }
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

export function requireRoles(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const role = (req.user as { role?: string } | undefined)?.role;
    if (!role || !roles.includes(role)) {
      return reply.status(403).send({ error: 'Forbidden: insufficient role' });
    }
  };
}

export async function authPlugin(app: FastifyInstance) {
  app.decorate('authenticate', requireAuth);
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
