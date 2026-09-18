import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './config.js';
import { prisma } from './lib/db.js';
import { authPlugin } from './lib/auth.js';
import { authRoutes } from './modules/auth.js';
import { medicineRoutes } from './modules/medicines.js';
import { customerRoutes, supplierRoutes } from './modules/people.js';
import { saleRoutes } from './modules/sales.js';
import { reportRoutes } from './modules/reports.js';
import { durRoutes } from './modules/dur.js';
import { settingsRoutes } from './modules/settings.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(authPlugin);

  await app.register(swagger, {
    openapi: {
      info: { title: 'Pharmacy Management API', version: '1.0.0', description: 'Sellable pharmacy management system — medicines, inventory, POS, customers, suppliers, reports, audit trail.' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async () => ({ ok: true, service: 'pharmacy-backend', time: new Date().toISOString() }));
  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ready: true };
    } catch {
      return reply.status(503).send({ ready: false });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(medicineRoutes);
      await api.register(customerRoutes);
      await api.register(supplierRoutes);
      await api.register(saleRoutes);
      await api.register(reportRoutes);
      await api.register(durRoutes);
      await api.register(settingsRoutes);
    },
    { prefix: '/api' },
  );

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status >= 500 ? 500 : status).send({
      error: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  return app;
}
