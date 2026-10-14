import { describe, expect, it } from "vitest";

/** Mirrors AiTranslationReview column direction for RTL component coverage (FIXTURE). */
export function columnDir(locale: "en" | "ar") {
  return locale === "ar" ? "rtl" : "ltr";
}

describe("translation review UI locale (FIXTURE)", () => {
  it("uses rtl for Arabic columns and ltr for English", () => {
    expect(columnDir("en")).toBe("ltr");
    expect(columnDir("ar")).toBe("rtl");
  });
});
