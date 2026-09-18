#!/usr/bin/env bash
# Record → MP4 → GIF pipeline for README demo. Verified on this stack Sep 2026.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/docs/assets"
mkdir -p "$ASSETS" "$ASSETS/screenshots"

echo "== 1/4 stack up =="
cd "$ROOT"
docker compose up --build -d
docker compose exec backend npm run db:seed

echo "== 2/4 screenshots (Playwright MCP verified) =="
echo "Screenshots already in $ASSETS/screenshots (01-dashboard, 02-pos, 03-inventory, 04-medicines, 05-reports)"
ls -lh "$ASSETS/screenshots"

echo "== 3/4 e2e gate (must be 14/14 before recording) =="
cd "$ROOT/frontend"
E2E_BASE_URL=http://localhost:8095 npx playwright test --reporter=list

echo "== 4/4 GIF convert (needs docs/assets/demo.mp4 from screen recorder) =="
if [ -f "$ASSETS/demo.mp4" ]; then
  ffmpeg -y -i "$ASSETS/demo.mp4" -vf "fps=10,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" -loop 0 "$ASSETS/demo.gif"
  ls -lh "$ASSETS/demo.gif" "$ASSETS/demo.mp4"
  echo "Embed: ![Demo](docs/assets/demo.gif)"
else
  echo "No $ASSETS/demo.mp4 yet — record 15-30s (login → POS → charge → invoice → return) then re-run."
  echo "See docs/demo-video.md Option A/B/C."
fi
