# Overview layout verification (QOS-149)

Playwright bounding-box checks for `.qosp-rail`, `.qosp-hero`, `.qosp-dock`, Storefronts tile, and `.qosp-overview-footer` on `/dev/overview-layout-harness`.

Re-run locally (Playwright is installed outside the repo):

```bash
npm run dev -- -p 3000
# in a temp directory: npm install playwright && npx playwright install chromium
QOS_REPO_ROOT=/workspace node /tmp/playwright-qos/measure.mjs --base-url=http://localhost:3000
```

Artifacts: `measurements.md`, `measurements.json`, and screenshots at 1024/960/853/731 × 900px height.
