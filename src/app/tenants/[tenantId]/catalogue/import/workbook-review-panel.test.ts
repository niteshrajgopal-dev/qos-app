import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { STAFF_UI_COPY, type StaffLocale } from "@/lib/staff/locale";
import { buildFoodicsMenuFixture } from "@/lib/workbook/foodics-menu/fixture";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { toReviewInput } from "@/lib/workbook/validation/input";
import type { WorkbookReviewResult } from "@/lib/workbook/validation/model";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { BRAND, snapshotFrom, TENANT } from "@/lib/workbook/validation/test-support";

import { WorkbookReviewPanel } from "./workbook-review-panel";
import { decisionChoices } from "./workbook-review-row";

const localeState = vi.hoisted(() => ({ locale: "en" as StaffLocale }));
vi.mock("@/components/staff/StaffLocaleProvider", () => ({
  useStaffLocale: () => ({ locale: localeState.locale, setLocale: () => undefined }),
}));

let result: WorkbookReviewResult;

beforeAll(async () => {
  const bytes = await buildFoodicsMenuFixture({ filled: true, prefillLastRow: 40 });
  const parsed = await parseWorkbookUpload(
    { fileName: "menu.xlsx", bytes },
    { tenantPublicId: TENANT, brandPublicIds: [BRAND], tenantCurrency: "AED", brandPublicId: BRAND, brandChoices: [{ publicId: BRAND, name: "Quotes" }] },
  );
  const review = reviewWorkbook(toReviewInput(parsed, { tenantPublicId: TENANT, brandPublicId: BRAND, currency: "AED" }), snapshotFrom());
  result = {
    ...review,
    plan: {
      publicId: "wbp_0123456789abcdef",
      revision: 1,
      status: "review_ready",
      planHash: "h".repeat(64),
      snapshotHash: "s".repeat(64),
      engineVersion: "qos194.1",
      createdAt: "2026-11-22T00:00:00.000Z",
      reviewedAt: "2026-11-22T00:00:00.000Z",
      createdBySubject: "alice",
    },
    stale: false,
  };
});

function render(locale: StaffLocale) {
  localeState.locale = locale;
  return renderToStaticMarkup(createElement(WorkbookReviewPanel, { tenantId: "00000000-0000-4000-8000-000000000001", initialResult: result }));
}

describe("workbook review panel", () => {
  it("shows the plan, counts, context and a conflicting row with candidates first, in English", () => {
    const html = render("en");
    const en = STAFF_UI_COPY.en;
    expect(html).toContain(en.reviewTitle);
    expect(html).toContain(en.reviewNotApplied);
    expect(html).toContain("wbp_0123456789abcdef");
    expect(html).toContain(en.reviewKeysUnverified);
    expect(html).toContain("foodics-menu-v1:ten_quotes_dev");
    for (const label of [en.reviewClassCreate, en.reviewClassConflicting, en.reviewClassBlocked, en.reviewClassUnsupported]) {
      expect(html).toContain(label);
    }
    // Rows needing a decision are shown first; the Flat White collision lists its candidate.
    expect(html).toContain(`aria-pressed="true"`);
    expect(html).toContain("prd_flat_white");
    expect(html).toContain(en.reviewRowCandidates);
    expect(html).toContain(en.reviewDecisionMatchExisting);
    expect(html).toContain(en.reviewDecisionCreateNew);
    expect(html).toContain(en.reviewRerun);
    expect(html).toContain(en.reviewDownloadReport);
    expect(html).toContain(en.reviewAcksTitle);
    expect(html).not.toMatch(/>\s*Apply[^<]*</i);
  });

  it("renders the same panel in Arabic without English chrome", () => {
    const html = render("ar");
    const ar = STAFF_UI_COPY.ar;
    expect(html).toContain(ar.reviewTitle);
    expect(html).toContain(ar.reviewNotApplied);
    expect(html).toContain(ar.reviewClassConflicting);
    expect(html).toContain(ar.reviewDecisionMatchExisting);
    expect(html).toContain("فلات وايت");
    for (const english of [STAFF_UI_COPY.en.reviewRerun, STAFF_UI_COPY.en.reviewRowCandidates, STAFF_UI_COPY.en.reviewDecisionMatchExisting]) {
      expect(html).not.toContain(english);
    }
  });

  it("offers decisions that fit the row: match or create for a name collision, accept for a stale revision, exclude always", () => {
    const conflicting = result.rows.find((row) => row.classification === "conflicting" && row.sheet === "Products")!;
    expect(decisionChoices(conflicting)).toEqual(["match_existing", "create_new", "exclude"]);
    const unsupported = result.rows.find((row) => row.classification === "unsupported")!;
    expect(decisionChoices(unsupported)).toEqual([]);
    expect(decisionChoices({ ...conflicting, candidates: undefined, diagnostics: [{ severity: "error", code: "stale_revision" }] })).toEqual([
      "accept_current_revision",
      "exclude",
    ]);
  });

  it("keeps state in memory only: no browser storage and no apply call", () => {
    for (const file of ["workbook-review-panel.tsx", "workbook-review-row.tsx"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|demoRows|\/apply/);
    }
  });
});
