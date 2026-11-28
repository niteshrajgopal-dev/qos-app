import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { STAFF_UI_COPY, type StaffLocale } from "@/lib/staff/locale";
import type { ApplyHistoryEntry } from "@/lib/workbook/apply/model";

import { WorkbookImportHistory, WorkbookImportHistoryList } from "./workbook-import-history";

/* QOS-200 follow-up: the "Past imports" list on the import page. Rendered to
   static markup in both languages: names instead of raw ids, counts, the
   open action, empty and error states, and nothing in browser storage. */

const localeState = vi.hoisted(() => ({ locale: "en" as StaffLocale }));
vi.mock("@/components/staff/StaffLocaleProvider", () => ({
  useStaffLocale: () => ({ locale: localeState.locale, setLocale: () => undefined }),
}));

const ENTRY: ApplyHistoryEntry = {
  publicId: "wba_0123456789abcdef",
  status: "completed",
  planPublicId: "wbp_fedcba9876543210",
  fileName: "menu-and-stock.xlsx",
  sourceProfile: "qos_extended_v1",
  templateVersion: "1.5",
  planRevision: 2,
  actorDisplayName: "Alice Admin",
  actorRole: "administrator",
  startedAt: "2026-11-28T10:00:00.000Z",
  finishedAt: "2026-11-28T10:01:00.000Z",
  counts: { applied: 19, alreadyApplied: 0, failed: 1, notApplied: 2, deferredValues: 6 },
};

function list(locale: StaffLocale, props: Partial<Parameters<typeof WorkbookImportHistoryList>[0]> = {}) {
  localeState.locale = locale;
  return renderToStaticMarkup(
    createElement(WorkbookImportHistoryList, { state: { status: "ready", applies: [ENTRY, { ...ENTRY, publicId: "wba_1111111111111111", status: "failed", actorDisplayName: null }] }, opening: null, onOpen: () => undefined, onRefresh: () => undefined, ...props }),
  );
}

describe("past imports", () => {
  it("lists each apply with its file, status, actor name, times and counts, and an open action, in English and Arabic", () => {
    for (const locale of ["en", "ar"] as const) {
      const copy = STAFF_UI_COPY[locale];
      const html = list(locale);
      expect(html, locale).toContain(copy.importHistoryTitle);
      expect(html, locale).toContain("menu-and-stock.xlsx");
      expect(html, locale).toContain(copy.applyAttemptCompleted);
      expect(html, locale).toContain(copy.applyAttemptFailed);
      expect(html, locale).toContain("Alice Admin");
      expect(html, locale).toContain(copy.applyActorUnknown);
      expect(html, locale).toContain(copy.importHistoryOpen);
      expect(html, locale).toContain(copy.importHistoryRefresh);
      expect(html, locale).toContain(`<code class="qosp-code" dir="ltr">wba_0123456789abcdef</code>`);
      expect(html, locale).not.toMatch(/QOS-\d/);
    }
    expect(list("en")).toContain("Saved 19 · already saved 0 · failed 1 · not applied 2 · deferred values 6");
    // No English chrome in Arabic: data (file names, actor names, ids) aside.
    const ar = list("ar").replace(/menu-and-stock\.xlsx|Alice Admin|wba_[0-9a-f]{16}|qosp-[a-z-]+|class="[^"]*"|dir="[a-z]+"|aria-[a-z]+="[^"]*"|type="button"/g, "");
    for (const english of [STAFF_UI_COPY.en.importHistoryTitle, STAFF_UI_COPY.en.importHistoryOpen, STAFF_UI_COPY.en.applyActorUnknown, "Saved", "Started"]) {
      expect(ar).not.toContain(english);
    }
    expect(ar.replace(/<[^>]*>/g, "")).not.toMatch(/[A-Za-z]/);
  });

  it("shows the empty, loading, error and opening states", () => {
    expect(list("en", { state: { status: "ready", applies: [] } })).toContain(STAFF_UI_COPY.en.importHistoryEmpty);
    expect(list("ar", { state: { status: "loading" } })).toContain(STAFF_UI_COPY.ar.importHistoryLoading);
    expect(list("en", { state: { status: "error" } })).toContain(STAFF_UI_COPY.en.importHistoryError);
    expect(list("en", { opening: "wbp_fedcba9876543210" })).toContain(STAFF_UI_COPY.en.importHistoryOpening);
    // Not an administrator: the list is not shown at all.
    expect(list("en", { state: { status: "hidden" } })).toBe("");
  });

  it("starts loading on the page and keeps everything in memory", () => {
    localeState.locale = "en";
    const html = renderToStaticMarkup(createElement(WorkbookImportHistory, { tenantId: "00000000-0000-4000-8000-000000000001", refreshKey: 0, onOpen: () => undefined }));
    expect(html).toContain(STAFF_UI_COPY.en.importHistoryLoading);
    const source = readFileSync(path.join(__dirname, "workbook-import-history.tsx"), "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|window\.confirm|demoRows/);
    expect(source).toContain("/catalogue/workbook/applies");
    expect(source).not.toMatch(/actorSubject/);
  });
});
