#!/usr/bin/env node
/**
 * Playwright layout probe for the tenant overview (Playwright installed outside the repo).
 *
 *   QOS_REPO_ROOT=/workspace node scripts/measure-overview-layout.mjs \
 *     --base-url=http://localhost:3000 --label=main --allow-failures
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const playwrightSpecifier =
  process.env.PLAYWRIGHT_MODULE_PATH ?? "playwright";
const playwrightModule = await import(playwrightSpecifier);
const { chromium } = playwrightModule.chromium
  ? playwrightModule
  : playwrightModule.default;

export const DENSE_WIDTHS = [
  681, 731, 768, 800, 853, 900, 960, 1024, 1100, 1180, 1280, 1366, 1440,
  1536, 1600, 1680, 1800, 1920,
];

export const DENSE_HEIGHTS = [
  500,
  550,
  ...Array.from({ length: (1100 - 600) / 25 + 1 }, (_, index) => 600 + index * 25),
];

export const ZOOM_VIEWPORTS = [
  { width: 853, height: 533, tag: "1280@150%" },
  { width: 731, height: 457, tag: "1280@175%" },
  { width: 960, height: 600, tag: "1440@150%" },
  { width: 823, height: 514, tag: "1440@175%" },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.QOS_REPO_ROOT
  ? path.resolve(process.env.QOS_REPO_ROOT)
  : path.resolve(__dirname, "..");
const artifactDir = path.join(repoRoot, "docs", "qos-149", "overview-layout");

function parseArgs() {
  const baseUrl =
    process.argv.find((arg) => arg.startsWith("--base-url="))?.split("=")[1] ??
    "http://localhost:3000";
  const label =
    process.argv.find((arg) => arg.startsWith("--label="))?.split("=")[1] ??
    "branch";
  const allowFailures = process.argv.includes("--allow-failures");
  return { baseUrl, label, allowFailures };
}

/** Ignore sub-pixel touching (layout probe noise at measured boundaries). */
const OVERLAP_EPSILON_PX = 1;

function intersects(a, b) {
  const gap = OVERLAP_EPSILON_PX;
  return !(
    a.right <= b.left + gap ||
    a.left >= b.right - gap ||
    a.bottom <= b.top + gap ||
    a.top >= b.bottom - gap
  );
}

function rectFromBox(box) {
  const left = Math.floor(box.x);
  const top = Math.floor(box.y);
  const right = Math.ceil(box.x + box.width);
  const bottom = Math.ceil(box.y + box.height);
  return { left, top, right, bottom };
}

function overlapSummary(pairs) {
  const hits = pairs.filter((pair) => pair.overlaps);
  return hits.length ? hits.map((h) => h.label).join("; ") : "";
}

function viewportList() {
  const list = [];
  for (const width of DENSE_WIDTHS) {
    for (const height of DENSE_HEIGHTS) {
      list.push({ width, height });
    }
  }
  for (const zoom of ZOOM_VIEWPORTS) {
    list.push({ width: zoom.width, height: zoom.height, tag: zoom.tag });
  }
  return list;
}

async function measureAt(page, baseUrl, width, height) {
  await page.setViewportSize({ width, height });
  const harnessUrl = new URL("/dev/overview-layout-harness", baseUrl).toString();
  await page.goto(harnessUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".qosp-rail");
  await page.waitForSelector(".qosp-dock");
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );

  const selectors = {
    rail: ".qosp-rail",
    hero: ".qosp-hero",
    dock: ".qosp-dock",
    storefronts: '.qosp-dock-item[href*="store"]',
    footer: ".qosp-overview-footer",
  };

  const boxes = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const locator = page.locator(selector).first();
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(`Missing bounding box for ${selector} at ${width}x${height}`);
    }
    boxes[key] = rectFromBox(box);
  }

  const railPosition = await page
    .locator(".qosp-rail")
    .evaluate((element) => getComputedStyle(element).position);

  const pairs = [
    { label: "rail×storefronts", overlaps: intersects(boxes.rail, boxes.storefronts) },
    { label: "rail×dock", overlaps: intersects(boxes.rail, boxes.dock) },
    { label: "rail×hero", overlaps: intersects(boxes.rail, boxes.hero) },
    { label: "rail×footer", overlaps: intersects(boxes.rail, boxes.footer) },
    { label: "hero×dock", overlaps: intersects(boxes.hero, boxes.dock) },
  ];

  const pass = pairs.every((pair) => !pair.overlaps);

  return {
    width,
    height,
    pass,
    overlap: overlapSummary(pairs),
    railPosition,
  };
}

function key(w, h) {
  return `${w}x${h}`;
}

const CSS_STACK_BANDS = [
  { minWidth: 681, maxWidth: 767, maxHeight: 874 },
  { minWidth: 768, maxWidth: 959, maxHeight: 874 },
  { minWidth: 960, maxWidth: 1023, maxHeight: 874 },
  { minWidth: 1024, maxWidth: 1180, maxHeight: 849 },
  { minWidth: 1181, maxWidth: 1599, maxHeight: 874 },
  { minWidth: 1600, maxWidth: null, maxHeight: 974 },
];

function analyzeBoundaries(mainResults) {
  const byWidth = new Map();
  for (const row of mainResults) {
    if (!byWidth.has(row.width)) {
      byWidth.set(row.width, []);
    }
    byWidth.get(row.width).push(row);
  }

  const perWidth = [];
  for (const width of DENSE_WIDTHS) {
    const rows = (byWidth.get(width) ?? []).sort((a, b) => a.height - b.height);
    const firstPass = rows.find((row) => row.pass);
    const lastFail = [...rows].reverse().find((row) => !row.pass);
    perWidth.push({
      width,
      lowestPassHeight: firstPass?.height ?? null,
      highestFailHeight: lastFail?.height ?? null,
    });
  }

  return { perWidth, cssStackBands: CSS_STACK_BANDS };
}

function compareBranchToMain(mainResults, branchResults) {
  const mainByKey = new Map(mainResults.map((row) => [key(row.width, row.height), row]));
  let mainPassBranchStacked = 0;
  const stackedSamples = [];

  for (const branch of branchResults) {
    const main = mainByKey.get(key(branch.width, branch.height));
    if (!main) {
      continue;
    }
    if (main.pass && branch.railPosition === "relative") {
      mainPassBranchStacked += 1;
      if (stackedSamples.length < 8) {
        stackedSamples.push({ width: branch.width, height: branch.height });
      }
    }
  }

  return { mainPassBranchStacked, stackedSamples };
}

function writeSummary({
  mainResults,
  branchResults,
  boundaries,
  comparison,
}) {
  const mainTotal = mainResults.length;
  const mainPass = mainResults.filter((row) => row.pass).length;
  const mainFail = mainTotal - mainPass;
  const branchTotal = branchResults.length;
  const branchPass = branchResults.filter((row) => row.pass).length;
  const branchFail = branchTotal - branchPass;

  const lines = [
    "# Overview layout measurements (summary)",
    "",
    "Dense grid: widths " +
      DENSE_WIDTHS.join(", ") +
      "; heights 500, 550, 600–1100 step 25; plus zoom viewports " +
      ZOOM_VIEWPORTS.map((z) => `${z.width}×${z.height} (${z.tag})`).join(", ") +
      ".",
    "",
    "Full per-cell results: `measurements-main-dense.json`, `measurements-branch-dense.json`.",
    "",
    "## Counts",
    "",
    "| Dataset | Total cells | PASS | FAIL |",
    "| --- | ---: | ---: | ---: |",
    `| \`origin/main\` CSS | ${mainTotal} | ${mainPass} | ${mainFail} |`,
    `| This branch CSS | ${branchTotal} | ${branchPass} | ${branchFail} |`,
    "",
    "## Main-PASS cells stacked on branch",
    "",
    `Count: **${comparison.mainPassBranchStacked}** (target **0**).` +
      (comparison.stackedSamples.length
        ? ` Examples: ${comparison.stackedSamples
            .map((s) => `${s.width}×${s.height}`)
            .join(", ")}.`
        : ""),
    "",
    "## Stack boundaries (from main dense grid)",
    "",
    "A single global `max-height` cannot cover all widths (e.g. 1024px passes from 850px tall while 731px passes from 900px). CSS uses width bands; each `max-height` is **one pixel below** the lowest main PASS height in that band.",
    "",
    ...boundaries.cssStackBands.map(
      (band) =>
        `- **${band.minWidth}–${band.maxWidth ?? "∞"}px** → stack when viewport height **≤ ${band.maxHeight}px**`,
    ),
    "",
    "Zoom cells on branch: " +
      ZOOM_VIEWPORTS.map((z) => {
        const row = branchResults.find(
          (r) => r.width === z.width && r.height === z.height,
        );
        return `${z.tag} ${z.width}×${z.height} → ${row?.pass ? "PASS" : "FAIL"}`;
      }).join("; ") +
      ".",
    "",
  ];

  writeFileSync(path.join(artifactDir, "measurements.md"), `${lines.join("\n")}\n`);
  writeFileSync(
    path.join(artifactDir, "measurements-boundaries.json"),
    JSON.stringify({ boundaries, comparison }, null, 2),
  );
}

async function main() {
  const { baseUrl, label, allowFailures } = parseArgs();
  mkdirSync(artifactDir, { recursive: true });
  const jsonName =
    label === "branch" ? "measurements-branch-dense.json" : `measurements-${label}-dense.json`;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  const results = [];
  for (const viewport of viewportList()) {
    const result = await measureAt(
      page,
      baseUrl,
      viewport.width,
      viewport.height,
    );
    results.push({
      ...result,
      tag: viewport.tag ?? null,
    });
    if (!result.pass) {
      console.error(`FAIL ${result.width}x${result.height}: ${result.overlap}`);
    }
  }

  await browser.close();

  writeFileSync(path.join(artifactDir, jsonName), JSON.stringify(results, null, 2));

  const failures = results.filter((row) => !row.pass);
  if (failures.length > 0 && !allowFailures) {
    console.error(`${failures.length}/${results.length} failed (${label}).`);
    process.exit(1);
  }

  console.log(
    `${label}: ${results.length - failures.length}/${results.length} passed.`,
  );
  console.log(`Wrote ${path.join(artifactDir, jsonName)}`);

  if (label === "branch") {
    const mainPath = path.join(artifactDir, "measurements-main-dense.json");
    const mainResults = JSON.parse(readFileSync(mainPath, "utf8"));
    const boundaries = analyzeBoundaries(mainResults);
    const comparison = compareBranchToMain(mainResults, results);
    writeSummary({
      mainResults,
      branchResults: results,
      boundaries,
      comparison,
    });
    console.log(`Summary: mainPassBranchStacked=${comparison.mainPassBranchStacked}`);
    if (comparison.mainPassBranchStacked > 0) {
      process.exit(1);
    }
    if (failures.length > 0) {
      process.exit(1);
    }
  }

  if (label === "main") {
    const boundaries = analyzeBoundaries(results);
    writeFileSync(
      path.join(artifactDir, "measurements-main-boundaries.json"),
      JSON.stringify(boundaries, null, 2),
    );
    console.log(`Main boundaries written to measurements-main-boundaries.json`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
