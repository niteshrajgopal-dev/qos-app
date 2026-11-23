import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { STAFF_UI_COPY, type StaffLocale } from "@/lib/staff/locale";

import { PortalFileInput } from "./PortalWorkspace";

const localeState = vi.hoisted(() => ({ locale: "en" as StaffLocale }));
vi.mock("@/components/staff/StaffLocaleProvider", () => ({
  useStaffLocale: () => ({ locale: localeState.locale, setLocale: () => undefined }),
}));

function render(locale: StaffLocale, fileName: string | null) {
  localeState.locale = locale;
  return renderToStaticMarkup(createElement(PortalFileInput, { accept: ".xlsx", fileName, onFile: () => undefined }));
}

describe("portal file input", () => {
  it("isolates the chosen file name left to right, so Arabic pages keep it in order", () => {
    for (const locale of ["en", "ar"] as const) {
      expect(render(locale, "05-combined-issues.xlsx"), locale).toContain(`<bdi dir="ltr">05-combined-issues.xlsx</bdi>`);
    }
  });

  it("shows the plain fallback when no file is chosen", () => {
    for (const locale of ["en", "ar"] as const) {
      const html = render(locale, null);
      expect(html, locale).toContain(STAFF_UI_COPY[locale].noFileChosen);
      expect(html, locale).not.toContain("<bdi");
    }
  });
});
