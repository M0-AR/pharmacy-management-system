/**
 * One-time test-database bootstrap (runs via `npm run pretest`):
 * applies Prisma migrations to TEST_DATABASE_URL and empties all tables.
 */
import { execSync } from 'node:child_process';

process.env.JWT_SECRET ??= 'test-suite-secret-min-32-chars-abcdef';
process.env.NODE_ENV = 'test';

function testDbUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? 'postgresql://pharmacy:pharmacy_Strong1!@localhost:5432/pharmacy?schema=public';
  return base.replace(/\/[^/?]+(\?|$)/, '/pharmacy_test$1');
}

const url = testDbUrl();
// Must precede any import of src/lib/db.ts (Prisma reads DATABASE_URL at construction).
process.env.DATABASE_URL = url;
console.log(`[test setup] migrating test database: ${url.replace(/:[^:@/]+@/, ':***@')}`);
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });

async function main() {
  const { truncateAll } = await import('./helpers.js');
  const { prisma } = await import('../src/lib/db.js');
  await truncateAll();
  await prisma.$disconnect();
  console.log('[test setup] test database ready');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
