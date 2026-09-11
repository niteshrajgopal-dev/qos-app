import { describe, expect, it } from "vitest";

import {
  normalizeProvisionBusinessInput,
  slugify,
} from "@/lib/onboarding/validation";

describe("normalizeProvisionBusinessInput", () => {
  it("accepts a valid Quotes-style onboarding payload", () => {
    const normalized = normalizeProvisionBusinessInput({
      businessName: "Quotes",
      businessProfile: "hospitality",
      brandName: "Quotes",
      locationName: "HBZ Stadium",
      locationTimezone: "Asia/Dubai",
      administratorEmail: "Admin@Quotes.test",
      baseCurrency: "aed",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    });

    expect(normalized.administratorEmail).toBe("admin@quotes.test");
    expect(normalized.baseCurrency).toBe("AED");
  });

  it("rejects unsupported currencies", () => {
    expect(() =>
      normalizeProvisionBusinessInput({
        businessName: "Quotes",
        businessProfile: "hospitality",
        brandName: "Quotes",
        locationName: "HBZ Stadium",
        locationTimezone: "Asia/Dubai",
        administratorEmail: "admin@quotes.test",
        baseCurrency: "USD",
        defaultLocale: "en",
        supportedLocales: ["en", "ar"],
      }),
    ).toThrow(/AED/);
  });
});

describe("slugify", () => {
  it("derives stable location slugs", () => {
    expect(slugify("HBZ Stadium")).toBe("hbz-stadium");
  });
});
