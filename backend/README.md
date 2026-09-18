# Backend — Fastify modular monolith (verified)

`fastify@4.28.1 + prisma@5.18 + zod + JWT 8h + pino` · `node:20-alpine` · `postgres:16`.

## Modules (`src/modules/`)

| File | Routes | Guards |
|---|---|---|
| `auth.ts` | `POST /auth/login`, `GET /auth/me`, `GET/POST/PATCH /users`, `POST /auth/password` | login open, `GET /users` ADMIN/PHARMACIST, writes ADMIN |
| `medicines.ts` | `GET /medicines (+low-stock/expired/:id/movements)`, `POST/PUT`, `POST :id/adjust`, `DELETE` | read auth, write ADMIN/PHARMACIST/TECHNICIAN, delete ADMIN/PHARMACIST |
| `sales.ts` | `GET /sales`, `GET /sales/:id`, `POST /sales`, `POST :id/void`, `POST :id/returns` | create any auth (Rx gate inside), void/return ADMIN/PHARMACIST |
| `people.ts` | `GET/POST/PUT/DELETE /customers`, `GET/POST/PUT/DELETE /suppliers` | delete customer ADMIN/PHARMACIST, delete supplier ADMIN |
| `dur.ts` | `POST /dur/check`, `POST /dur/acknowledge` | any auth, HIGH needs `note` |
| `reports.ts` | `GET /reports/summary`, `GET /audit-logs` | summary any auth, audit ADMIN/PHARMACIST |
| `settings.ts` | `GET/PUT /settings` | read auth, write ADMIN |

Core: `src/app.ts` (cors, helmet CSP-off for /docs, 300/min, JWT, swagger, /health, /ready), `src/config.ts` (zod env), `src/lib/auth.ts` (per-request active check), `src/lib/db.ts` (singleton), `src/lib/utils.ts` (audit swallow).

## Commands (verified)

```bash
npm install
npm run db:generate && npm run db:migrate:dev && npm run db:seed && npm run dev  # :4000
npm run lint && npm test && npm run test:coverage
```

See root `README.md` + `prisma/schema.prisma` (8 models, `SaleItem.medicine Restrict`).
