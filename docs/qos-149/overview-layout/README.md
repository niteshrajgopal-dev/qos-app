# Overview layout verification (QOS-149)

Playwright bounding-box checks for `.qosp-rail`, `.qosp-hero`, `.qosp-dock`, Storefronts tile, and `.qosp-overview-footer` on `/dev/overview-layout-harness` (non-production only; fixture data).

```bash
npm run dev -- -p 3000
# Playwright installed outside the repo, e.g. /tmp/playwright-qos
cp scripts/measure-overview-layout.mjs /tmp/playwright-qos/measure.mjs
cd /tmp/playwright-qos && npx playwright install chromium

# Baseline (swap in origin/main qos-portal.css first):
QOS_REPO_ROOT=/workspace node measure.mjs --base-url=http://localhost:3000 --label=main --allow-failures

# Branch CSS:
QOS_REPO_ROOT=/workspace node measure.mjs --base-url=http://localhost:3000 --label=branch
```

Artifacts: `measurements.md` (both tables), `measurements-main.json`, `measurements.json`.
