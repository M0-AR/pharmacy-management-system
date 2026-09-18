# Contributing

One feature = one PR + tests + docs/screenshot in the same PR (READMEs rot fastest — 2026 consensus).

## Setup (verified)

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec backend npm run db:seed
```

## Gates (must pass)

```bash
cd backend && npm run lint && npm test && npm run test:coverage
cd ../frontend && npm run lint && npm test && npm run test:coverage
E2E_BASE_URL=http://localhost:8095 npx playwright test   # 14/14
```

## Rules

- `getByRole`-first locators, web-first assertions, zero hard waits.
- API-level setup, UI asserts behavior (`frontend/e2e/fixtures.ts`).
- Unique fixtures per test (`uid()`), FK-safe truncate between files.
- Every stock change writes `stock_movements`; every auth/sale/user change writes `audit_logs`.
- Rx/DUR gates are server-side — never rely on UI hiding.
- Update `README.md` + `docs/assets/screenshots/` if UI changes. Re-record `docs/assets/demo.gif` on POS/invoice changes.

## Reviews

Small diffs, `tsc --noEmit` clean, no secrets in diff (`git diff --check`). Maintainer runs `bash docs/record-demo.sh` before release.
