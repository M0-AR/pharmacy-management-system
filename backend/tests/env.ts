/**
 * Preloaded via `tsx --import ./tests/env.ts` so test processes get
 * deterministic env BEFORE any src/* module (config/prisma) is evaluated.
 */
const testUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pharmacy:pharmacy_Strong1%21@localhost:5432/pharmacy_test?schema=public';

process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET ??= 'test-suite-secret-min-32-chars-abcdef';
process.env.JWT_EXPIRES_IN ??= '8h';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
