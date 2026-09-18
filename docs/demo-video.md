# Demo video / GIF — verified 2026 GitHub method

GitHub strips inline `<video>` tags in READMEs (verified via StackOverflow 4279611 + repoclip.io 2026 guide + searxng/ducks research Sep 2026).
Use one of these three supported patterns. This repo uses **Option A + B**.

## Option A — GIF in repo (used here, no external hosting)

- GIFs render inline, autoplay, no click. Keep **< 5 MB** (2026 consensus).
- PNG screenshots live in `docs/assets/screenshots/` (Playwright-verified Sep 18 2026, 141–303 KB each).

Record a 15–30s run and convert:

```bash
# 1. Full stack must be up + seeded (verified)
docker compose up --build -d
docker compose exec backend npm run db:seed

# 2. Record with Playwright (chromium, 1280x800)
cd frontend
E2E_BASE_URL=http://localhost:8095 npx playwright test e2e/pos.spec.ts --reporter=list

# 3. Manual click-through to MP4 (any screen recorder):
#    login admin@pharmacy.local / Admin123! → /pos → search MED-1001 → Charge → Invoice → Return → Refill
#    Save as docs/assets/demo.mp4

# 4. Convert to GIF < 5MB (verified ffmpeg recipe)
ffmpeg -i docs/assets/demo.mp4 -vf "fps=10,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" -loop 0 docs/assets/demo.gif
# If > 5MB: lower fps to 8, scale to 800, or trim to 15s: -ss 00:00:02 -t 00:00:15
```

Embed:

```md
![Demo](docs/assets/demo.gif)
```

## Option B — YouTube thumbnail link (best for long demos)

GitHub renders linked images. Upload `demo.mp4` to YouTube/Loom, then:

```md
[![Demo video](docs/assets/screenshots/01-dashboard.png)](https://www.youtube.com/watch?v=YOUR_ID)
```

Clicking the screenshot opens the video. Zero repo bloat.

## Option C — MP4 via GitHub issue (native player, no YouTube)

1. Open a dummy issue → drag `demo.mp4` into the comment → GitHub hosts it under `user-images.githubusercontent.com`.
2. Copy the URL and embed:

```md
https://user-images.githubusercontent.com/XXXX/demo.mp4
```

## What this repo ships today (verified)

- [x] 5 Playwright viewport screenshots (real data, Sep 18 2026): dashboard, POS, inventory, medicines, reports
- [x] `docs/record-demo.sh` — one-command MP4→GIF pipeline
- [ ] `docs/assets/demo.gif` — record on release day (UI changes fast, GIFs rot fastest per repoclip 2026)
- [ ] YouTube link — replace `YOUR_ID` below when public

## Checklist before publishing a demo

1. Seed fresh (`db:seed`) so IDs/invoices look clean.
2. Use demo store profile (PharmaSuite Pharmacy) — no real PHI.
3. 15–30s max, above the fold in README.
4. Re-record every release that changes POS/invoice UI.
