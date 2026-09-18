import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { auditLog, currentUserId, requestIp } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid credentials payload' });
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.active) return reply.status(401).send({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await auditLog({ action: 'auth.login.failed', entity: 'User', entityId: user.id, ip: requestIp(req) });
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    const token = app.jwt.sign(
      { sub: user.id, email: user.email, role: user.role, name: user.name },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } as never,
    );
    await auditLog({
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: requestIp(req),
    });
    return reply.send({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });

  app.get('/auth/me', { preHandler: [requireAuth] }, async (req) => {
    const id = currentUserId(req)!;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    return { user };
  });

  // Bootstrap + admin user management (minimum-necessary: only ADMIN/PHARMACIST list users)
  app.get('/users', { preHandler: [requireAuth] }, async (req, reply) => {
    const role = (req.user as { role: string }).role;
    if (!['ADMIN', 'PHARMACIST'].includes(role)) return reply.status(403).send({ error: 'Forbidden' });
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    return { users };
  });

  const createUserSchema = z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(72),
    role: z.enum(['ADMIN', 'PHARMACIST', 'TECHNICIAN', 'CASHIER']).default('CASHIER'),
  });

  app.post('/users', { preHandler: [requireAuth] }, async (req, reply) => {
    const role = (req.user as { role: string }).role;
    if (role !== 'ADMIN') return reply.status(403).send({ error: 'Only ADMIN can create users' });
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const exists = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase().trim() } });
    if (exists) return reply.status(409).send({ error: 'Email already in use' });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const created = await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email: parsed.data.email.toLowerCase().trim(),
        passwordHash,
        role: parsed.data.role,
      },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    await auditLog({ actorId: currentUserId(req), action: 'user.create', entity: 'User', entityId: created.id, ip: requestIp(req) });
    return reply.status(201).send({ user: created });
  });

  app.patch('/users/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const role = (req.user as { role: string }).role;
    if (role !== 'ADMIN') return reply.status(403).send({ error: 'Only ADMIN can change user status' });
    const { id } = req.params as { id: string };
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    if (id === currentUserId(req) && parsed.data.active === false) {
      return reply.status(400).send({ error: 'You cannot deactivate your own account' });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.status(404).send({ error: 'User not found' });
    if (target.role === 'ADMIN' && parsed.data.active === false) {
      const otherAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true, id: { not: id } } });
      if (otherAdmins === 0) return reply.status(400).send({ error: 'Cannot deactivate the last active admin' });
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { active: parsed.data.active },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    await auditLog({ actorId: currentUserId(req), action: parsed.data.active ? 'user.activate' : 'user.deactivate', entity: 'User', entityId: id, ip: requestIp(req) });
    return { user: updated };
  });

  const passwordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(72),
  });

  app.post('/auth/password', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    const id = currentUserId(req)!;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) return reply.status(400).send({ error: 'Current password is incorrect' });
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
    await auditLog({ actorId: id, action: 'auth.password.change', entity: 'User', entityId: id, ip: requestIp(req) });
    return { ok: true };
  });
}
