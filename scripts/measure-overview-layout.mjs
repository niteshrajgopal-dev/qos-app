#!/usr/bin/env node
/**
 * Playwright layout probe for the tenant overview (run locally; Playwright is not
 * a project dependency). Usage:
 *   node scripts/measure-overview-layout.mjs --base-url http://localhost:3000
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const playwrightSpecifier =
  process.env.PLAYWRIGHT_MODULE_PATH ?? "playwright";
const { chromium } = await import(playwrightSpecifier);

const WIDTHS = [
  1920, 1600, 1440, 1366, 1280, 1200, 1100, 1024, 960, 901, 900, 853, 800,
  731, 681, 680, 640, 480, 390, 320,
];

const HEIGHTS = [900, 800, 600];

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
  const screenshots = process.argv.includes("--screenshots");
  return { baseUrl, label, allowFailures, screenshots };
}

function intersects(a, b) {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

function rectFromBox(box) {
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
  };
}

function overlapSummary(pairs) {
  const hits = pairs.filter((pair) => pair.overlaps);
  return hits.length ? hits.map((h) => h.label).join("; ") : "";
}

async function measureAt(page, baseUrl, width, height) {
  await page.setViewportSize({ width, height });
  const harnessUrl = new URL("/dev/overview-layout-harness", baseUrl).toString();
  await page.goto(harnessUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".qosp-rail");
  await page.waitForSelector(".qosp-dock");

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

  const pairs = [
    { label: "rail×storefronts", overlaps: intersects(boxes.rail, boxes.storefronts) },
    { label: "rail×dock", overlaps: intersects(boxes.rail, boxes.dock) },
    { label: "rail×hero", overlaps: intersects(boxes.rail, boxes.hero) },
    { label: "rail×footer", overlaps: intersects(boxes.rail, boxes.footer) },
    { label: "hero×dock", overlaps: intersects(boxes.hero, boxes.dock) },
  ];

  const pass = pairs.every((pair) => !pair.overlaps);

  return { width, height, pass, overlap: overlapSummary(pairs), pairs, boxes };
}

async function main() {
  const { baseUrl, label, allowFailures, screenshots } = parseArgs();
  mkdirSync(artifactDir, { recursive: true });
  const mdName = label === "branch" ? "measurements.md" : `measurements-${label}.md`;
  const jsonName = label === "branch" ? "measurements.json" : `measurements-${label}.json`;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  const results = [];

  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      const result = await measureAt(page, baseUrl, width, height);
      results.push({
        width: result.width,
        height: result.height,
        pass: result.pass,
        overlap: result.overlap,
      });

      if (!result.pass) {
        console.error(
          `FAIL ${width}x${height}: ${result.overlap}`,
        );
      }

      if (screenshots && height === 900) {
        const file = path.join(
          artifactDir,
          `overview-${label}-${width}x${height}.png`,
        );
        await page.screenshot({ path: file, fullPage: true });
      }
    }
  }

  await browser.close();

  const tableLines = [
    "| Width | Height | Pass | Overlaps |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (row) =>
        `| ${row.width} | ${row.height} | ${row.pass ? "PASS" : "**FAIL**"} | ${row.overlap || "—"} |`,
    ),
  ];

  writeFileSync(path.join(artifactDir, mdName), `${tableLines.join("\n")}\n`);
  writeFileSync(
    path.join(artifactDir, jsonName),
    JSON.stringify(results, null, 2),
  );

  const failures = results.filter((row) => !row.pass);
  if (failures.length > 0 && !allowFailures) {
    console.error(`${failures.length} viewport combinations failed overlap checks.`);
    process.exit(1);
  }

  if (failures.length === 0) {
    console.log(`All ${results.length} viewport combinations passed.`);
  } else {
    console.log(
      `${failures.length}/${results.length} viewport combinations failed (${label}).`,
    );
  }
  console.log(`Wrote ${path.join(artifactDir, mdName)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
