# Frontend — Vite React SPA (verified)

`react@18.3.1 + vite@6 + react-router@6 + tanstack-query@5 + axios + recharts + tailwind@3` · `nginx:1.27-alpine`.

## Pages (`src/pages/13`)

Dashboard, POS (scanner + DUR + charge), Sales + Invoice (returns, void, refill), Medicines (CRUD + ledger drawer + CSV), Inventory (adjust + low/expired), Customers (history), Suppliers, Reports (bar + pie), Audit (append-only), Users (ADMIN), Settings (white-label + password), Login (prefilled demo).

Key: `src/lib/api.ts` (Bearer + 401→/login), `src/lib/auth.tsx` (session), `src/lib/store.ts` (settings merge + CSV), `src/App.tsx` (auth-only guard — role enforced server-side).

## Commands (verified)

```bash
npm install && npm run dev   # :5173 proxies /api → :4000
npm run lint && npm test && npm run test:coverage
E2E_BASE_URL=http://localhost:8095 npx playwright test   # 14/14 vs compose
```

Screenshots: `../docs/assets/screenshots/` (Playwright). Demo recipe: `../docs/demo-video.md`.
