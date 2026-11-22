import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FoodicsMenuResult } from "@/app/tenants/[tenantId]/catalogue/import/foodics-menu-result";
import { STAFF_UI_COPY } from "@/lib/staff/locale";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";

const css = readFileSync(path.join(process.cwd(), "src/app/qos-portal-workspace.css"), "utf8");

const RESULT: FoodicsMenuParseResult = {
  profile: "foodics_menu_v1",
  profileVersion: 1,
  dictionaryVersion: "1.1",
  fileName: "AZURCAFE CAFETERIA Menu Template .xlsx",
  fileFingerprint: "2a73c4f1aaaaaaaa",
  templateVersion: "1",
  layout: {
    regions: [],
    ignoredSheets: [
      { sheet: "Localization", reason: "guidance" },
      { sheet: "Main Menu | القائمة الرئيسية", reason: "guidance" },
      { sheet: "7- Users", reason: "credentials" },
      { sheet: "Review Dashboard", reason: "guidance" },
    ],
  },
  context: {
    tenantPublicId: "ten_quotes_dev",
    brandPublicId: "brd_quotes",
    currency: "AED",
    sourceNamespace: "foodics-menu-v1:ten_quotes_dev",
  },
  requiredMappings: [
    { kind: "currency", status: "resolved", value: "AED" },
    { kind: "brand", status: "resolved", value: "brd_quotes" },
    { kind: "namespace", status: "resolved", value: "foodics-menu-v1:ten_quotes_dev" },
  ],
  sheets: [],
  capabilities: [],
  issues: [],
  summary: {
    supported: { sheets: 0, rows: 0 },
    deferred: { sheets: 0, rows: 0 },
    rejected: { sheets: 0, rows: 0 },
    separate_profile: { sheets: 0, rows: 0 },
    errors: 0,
    warnings: 0,
    recognizedRows: 0,
    deferredRows: 0,
    deferredValues: 0,
  },
};

function renderPanel() {
  return renderToStaticMarkup(
    createElement(FoodicsMenuResult, {
      result: RESULT,
      brand: "brd_quotes",
      onBrandChange: () => undefined,
      converting: false,
      onConvert: () => undefined,
      issueList: null,
    }),
  );
}

function ruleBodies(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1],
  );
}

function mediaBlocks(source: string, width: number) {
  const blocks: string[] = [];
  const marker = `@media (max-width: ${width}px) {`;
  for (let at = source.indexOf(marker); at > -1; at = source.indexOf(marker, at + 1)) {
    let depth = 0;
    for (let index = at + marker.length - 1; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(at + marker.length, index));
        break;
      }
    }
  }
  return blocks;
}

function sliceForSheet(html: string, sheet: string) {
  const at = html.indexOf(`>${sheet}<`);
  expect(at, sheet).toBeGreaterThan(-1);
  const rowStart = html.lastIndexOf("<li", at);
  const rowEnd = html.indexOf("</li>", at);
  return html.slice(rowStart, rowEnd);
}

describe("Foodics menu result layout (QOS-216 follow-up)", () => {
  it("lets only the credentials ignored-sheet badge wrap", () => {
    const html = renderPanel();
    const users = sliceForSheet(html, "7- Users");
    expect(users).toContain('data-wrap="true"');
    expect(users).toContain(`data-tone="warm"`);
    expect(users).toContain(STAFF_UI_COPY.en.importIgnoredCredentials);

    const guidance = sliceForSheet(html, "Localization");
    expect(guidance).toContain(STAFF_UI_COPY.en.importIgnoredGuidance);
    expect(guidance).not.toContain("data-wrap");

    expect((html.match(/data-tone="positive"/g) ?? []).length).toBeGreaterThan(0);
    expect(html.split('data-wrap="true"').length - 1).toBe(1);
  });

  it("wraps the long credentials badge inside the card without changing other badges", () => {
    const wrap = ruleBodies(css, '.qosp-badge[data-wrap="true"]').join(";");
    expect(wrap).toMatch(/white-space:\s*normal/);
    expect(wrap).toMatch(/min-width:\s*0/);
    expect(wrap).toMatch(/max-width:\s*100%/);

    const defaultBadge = ruleBodies(css, ".qosp-badge").join(";");
    expect(defaultBadge).toMatch(/white-space:\s*nowrap/);
  });

  it("keeps four Foodics stat tiles on a 2×2 grid at desktop and at 360px", () => {
    const html = renderPanel();
    expect(html).toContain('class="qosp-stats-grid" data-columns="2"');
    expect((html.match(/class="qosp-stat qosp-glass"/g) ?? []).length).toBe(4);

    const twoCol = ruleBodies(css, '.qosp-stats-grid[data-columns="2"]').join(";");
    expect(twoCol).toMatch(/grid-template-columns:\s*repeat\(2,/);

    const defaultGrid = ruleBodies(css, ".qosp-stats-grid").join(";");
    expect(defaultGrid).toMatch(/grid-template-columns:\s*repeat\(3,/);

    const narrow = mediaBlocks(css, 680).join("\n");
    expect(ruleBodies(narrow, ".qosp-stats-grid").join(";")).toMatch(/grid-template-columns:\s*1fr\s+1fr/);
  });
});
