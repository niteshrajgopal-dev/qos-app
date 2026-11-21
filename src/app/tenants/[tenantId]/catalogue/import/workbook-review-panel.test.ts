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

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

function render(locale: StaffLocale, initialResult: WorkbookReviewResult = result) {
  localeState.locale = locale;
  return renderToStaticMarkup(createElement(WorkbookReviewPanel, { tenantId: TENANT_ID, initialResult }));
}

const PREVIEW = { create: 12, update: 3, notApplied: 7, deferredValues: 5 };

function readyPlan(canApply: boolean): WorkbookReviewResult {
  return {
    ...result,
    apply: {
      permissions: canApply ? { canApply: true } : { canApply: false, reason: "not_administrator" },
      preview: PREVIEW,
      attempts: [],
    },
  };
}

function appliedPlan(): WorkbookReviewResult {
  // The panel opens on rows needing a decision, so the outcome goes on the first one shown.
  const first = result.rows.findIndex((row) => row.sheet === "Products" && row.classification === "conflicting");
  const rows = result.rows.map((row, index) =>
    index === first
      ? {
          ...row,
          apply: {
            state: "applied" as const,
            appliedPublicId: "prd_espresso_1a2b3c4d",
            appliedAt: "2026-11-22T10:01:00.000Z",
            applyPublicId: "wba_0123456789abcdef",
            error: null,
            result: {
              operation: "create" as const,
              fieldsApplied: ["internal_name"],
              deferred: [{ column: "tax_rate_basis_points", owner: "QOS-212" }],
              links: [{ namespace: "foodics-menu-v1:ten_quotes_dev", entityType: "product" as const, sourceKey: "espresso", targetPublicId: "prd_espresso_1a2b3c4d" }],
            },
          },
        }
      : { ...row, apply: { state: "not_applied" as const, appliedPublicId: null, appliedAt: null, applyPublicId: "wba_0123456789abcdef", error: null, result: null } },
  );
  return {
    ...result,
    rows,
    plan: { ...result.plan, status: "applied" },
    apply: {
      permissions: { canApply: false, reason: "applied" },
      preview: PREVIEW,
      attempts: [
        {
          publicId: "wba_0123456789abcdef",
          status: "completed",
          actorSubject: "admin-alice",
          actorRole: "administrator",
          planRevision: 1,
          planHash: "h".repeat(64),
          startedAt: "2026-11-22T10:00:00.000Z",
          finishedAt: "2026-11-22T10:01:00.000Z",
          counts: { applied: 41, alreadyApplied: 2, failed: 0, notApplied: 9, deferredValues: 6 },
          summary: {},
        },
      ],
    },
  };
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

  it("offers apply to an administrator of a ready plan, with the preview, in English and Arabic", () => {
    const en = render("en", readyPlan(true));
    expect(en).toContain(STAFF_UI_COPY.en.applyTitle);
    expect(en).toContain(STAFF_UI_COPY.en.applyButton);
    expect(en).toContain("Will create 12, update 3; 7 rows stay unapplied; 5 deferred values stay unsaved.");
    expect(en).not.toContain(STAFF_UI_COPY.en.applyBlockNotAdministrator);
    expect(en).not.toContain(STAFF_UI_COPY.en.applyHistoryTitle);
    const ar = render("ar", readyPlan(true));
    expect(ar).toContain(STAFF_UI_COPY.ar.applyButton);
    expect(ar).not.toContain(STAFF_UI_COPY.en.applyButton);
  });

  it("explains why a non-administrator cannot apply, in English and Arabic", () => {
    const en = render("en", readyPlan(false));
    expect(en).toContain(STAFF_UI_COPY.en.applyBlockNotAdministrator);
    expect(en).not.toContain(STAFF_UI_COPY.en.applyButton);
    const ar = render("ar", readyPlan(false));
    expect(ar).toContain(STAFF_UI_COPY.ar.applyBlockNotAdministrator);
    expect(ar).not.toContain(STAFF_UI_COPY.ar.applyButton);
  });

  it("shows results, saved versus parsed, per-row outcomes and history for an applied plan", () => {
    for (const locale of ["en", "ar"] as const) {
      const copy = STAFF_UI_COPY[locale];
      const html = render(locale, appliedPlan());
      expect(html, locale).toContain(copy.applyStatusApplied);
      expect(html, locale).not.toContain(`>${copy.reviewStatusReady}<`);
      expect(html, locale).toContain(copy.applyResultsTitle);
      expect(html, locale).toContain(">41<");
      expect(html, locale).toContain(copy.applySavedVsParsedTitle);
      expect(html, locale).toContain(copy.applyDraftsNote);
      expect(html, locale).toContain(copy.applyBlockApplied);
      expect(html, locale).toContain(copy.applyRowApplied);
      expect(html, locale).toContain(copy.applyRowTitle);
      expect(html, locale).toContain("foodics-menu-v1:ten_quotes_dev:espresso → prd_espresso_1a2b3c4d");
      expect(html, locale).toContain(`/tenants/${TENANT_ID}/catalogue/products/prd_espresso_1a2b3c4d/edit`);
      expect(html, locale).toContain(copy.applyHistoryTitle);
      expect(html, locale).toContain("admin-alice");
      expect(html, locale).toContain(copy.applyAttemptCompleted);
      expect(html, locale).not.toContain(copy.reviewNotApplied);
      expect(html, locale).not.toContain(copy.applyButton);
    }
  });

  it("offers revalidate and retry after a failed apply", () => {
    const failed = appliedPlan();
    const html = render("en", { ...failed, plan: { ...failed.plan, status: "apply_failed" }, apply: { ...failed.apply!, permissions: { canApply: false, reason: "apply_failed" } } });
    expect(html).toContain(STAFF_UI_COPY.en.applyStatusFailed);
    expect(html).toContain(STAFF_UI_COPY.en.applyRetryButton);
    expect(html).toContain(STAFF_UI_COPY.en.applyRetryHelp);
  });

  it("the apply section never uses browser storage, a browser confirm or simulated rows", () => {
    const source = readFileSync(path.join(__dirname, "workbook-apply-panel.tsx"), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|window\.confirm|confirm\(|demoRows/);
  });

  it("keeps state in memory only: no browser storage, and the apply call only in the apply section", () => {
    for (const file of ["workbook-review-panel.tsx", "workbook-review-row.tsx"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|demoRows|\}\/apply/);
    }
  });
});
