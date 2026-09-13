import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  StorefrontThemeValidationError,
  validateStorefrontThemeDraftInput,
} from "@/lib/storefront/storefront-theme-schema";

describe("storefront theme schema", () => {
  const validTheme = {
    schemaVersion: 1,
    preset: "hospitality_baseline",
    colors: {
      primary: "#2F2322",
      accent: "#CBB792",
      background: "#F5F1E9",
      text: "#2F2322",
    },
    typography: {
      body: "inter",
      display: "young-serif",
    },
  };

  it("accepts a valid hospitality theme draft", () => {
    const theme = validateStorefrontThemeDraftInput(validTheme);

    expect(theme.preset).toBe("hospitality_baseline");
    expect(theme.colors.primary).toBe("#2F2322");
    expect(theme.typography.body).toBe("inter");
  });

  it("rejects unknown top-level fields and platform-owned keys", () => {
    expect(() =>
      validateStorefrontThemeDraftInput({
        ...validTheme,
        renderer: "custom",
      }),
    ).toThrow(StorefrontThemeValidationError);

    expect(() =>
      validateStorefrontThemeDraftInput({
        ...validTheme,
        checkout: { secret: true },
      }),
    ).toThrow(StorefrontThemeValidationError);
  });

  it("rejects invalid colors, presets and typography", () => {
    expect(() =>
      validateStorefrontThemeDraftInput({
        ...validTheme,
        preset: "quotes_only",
      }),
    ).toThrow(StorefrontThemeValidationError);

    expect(() =>
      validateStorefrontThemeDraftInput({
        ...validTheme,
        colors: {
          ...validTheme.colors,
          primary: "red",
        },
      }),
    ).toThrow(StorefrontThemeValidationError);

    expect(() =>
      validateStorefrontThemeDraftInput({
        ...validTheme,
        typography: {
          body: "comic-sans",
          display: "young-serif",
        },
      }),
    ).toThrow(StorefrontThemeValidationError);
  });

  it("rejects low-contrast text on background", () => {
    try {
      validateStorefrontThemeDraftInput({
        ...validTheme,
        colors: {
          ...validTheme.colors,
          text: "#F5F1E9",
          background: "#FFFFFF",
        },
      });
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(StorefrontThemeValidationError);
      expect(
        (error as StorefrontThemeValidationError).issues.some((issue) =>
          issue.field.includes("theme.colors.text"),
        ),
      ).toBe(true);
    }
  });

  it("computes contrast ratios for brand palette pairs", () => {
    expect(contrastRatio("#2F2322", "#F5F1E9")).toBeGreaterThan(4.5);
    expect(contrastRatio("#14532D", "#FFF7ED")).toBeGreaterThan(4.5);
  });
});
