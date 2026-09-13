export const STOREFRONT_THEME_SCHEMA_VERSION = 1;

export const SUPPORTED_STOREFRONT_THEME_SCHEMA_VERSIONS = [
  STOREFRONT_THEME_SCHEMA_VERSION,
] as const;

export const STOREFRONT_THEME_PRESET_IDS = [
  "hospitality_baseline",
  "generic_retail_baseline",
] as const;

export type StorefrontThemePresetId =
  (typeof STOREFRONT_THEME_PRESET_IDS)[number];

export const STOREFRONT_THEME_COLOR_TOKENS = [
  "primary",
  "accent",
  "background",
  "text",
] as const;

export type StorefrontThemeColorToken =
  (typeof STOREFRONT_THEME_COLOR_TOKENS)[number];

export const STOREFRONT_THEME_BODY_FONTS = ["inter", "system-ui"] as const;
export const STOREFRONT_THEME_DISPLAY_FONTS = ["young-serif", "system-ui"] as const;

export type StorefrontThemeBodyFont =
  (typeof STOREFRONT_THEME_BODY_FONTS)[number];
export type StorefrontThemeDisplayFont =
  (typeof STOREFRONT_THEME_DISPLAY_FONTS)[number];

export type StorefrontThemeDraft = {
  schemaVersion: typeof STOREFRONT_THEME_SCHEMA_VERSION;
  preset: StorefrontThemePresetId;
  colors: Record<StorefrontThemeColorToken, string>;
  typography: {
    body: StorefrontThemeBodyFont;
    display: StorefrontThemeDisplayFont;
  };
  logo?: {
    publicDerivativeId: string;
  };
};

export class StorefrontThemeValidationError extends Error {
  readonly field?: string;
  readonly issues: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    field?: string,
    issues: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
    this.name = "StorefrontThemeValidationError";
    this.field = field;
    this.issues = issues.length > 0 ? issues : field ? [{ field, message }] : [];
  }
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const PUBLIC_DERIVATIVE_ID_PATTERN = /^mda_[a-z0-9_]+$/;

const ALLOWED_THEME_KEYS = new Set([
  "schemaVersion",
  "preset",
  "colors",
  "typography",
  "logo",
]);

const ALLOWED_COLOR_KEYS = new Set(STOREFRONT_THEME_COLOR_TOKENS);
const ALLOWED_TYPOGRAPHY_KEYS = new Set(["body", "display"]);
const ALLOWED_LOGO_KEYS = new Set(["publicDerivativeId"]);

const PLATFORM_OWNED_THEME_KEYS = new Set(["renderer", "checkout", "security"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  fieldPrefix: string,
  issues: Array<{ field: string; message: string }>,
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        field: `${fieldPrefix}.${key}`,
        message: "Unknown theme field is not allowed.",
      });
    }
  }
}

function parseHexColor(value: unknown, field: string) {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value.trim())) {
    throw new StorefrontThemeValidationError(
      "Color must be a 6-digit hex value such as #2F2322.",
      field,
    );
  }

  return value.trim().toUpperCase();
}

function channel(value: number) {
  const normalized = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return normalized;
}

function relativeLuminance(hex: string) {
  const normalized = hex.replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;

  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

export function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function validateContrast(
  foreground: string,
  background: string,
  field: string,
  minimumRatio: number,
  issues: Array<{ field: string; message: string }>,
) {
  const ratio = contrastRatio(foreground, background);
  if (ratio < minimumRatio) {
    issues.push({
      field,
      message: `Contrast ratio ${ratio.toFixed(2)}:1 is below the required ${minimumRatio}:1.`,
    });
  }
}

export function validateStorefrontThemeDraftInput(
  input: unknown,
): StorefrontThemeDraft {
  if (!isRecord(input)) {
    throw new StorefrontThemeValidationError(
      "Theme draft must be an object.",
      "theme",
    );
  }

  const issues: Array<{ field: string; message: string }> = [];

  for (const key of Object.keys(input)) {
    if (PLATFORM_OWNED_THEME_KEYS.has(key)) {
      issues.push({
        field: `theme.${key}`,
        message: "Platform-owned theme field cannot be modified.",
      });
      continue;
    }

    if (!ALLOWED_THEME_KEYS.has(key)) {
      issues.push({
        field: `theme.${key}`,
        message: "Unknown theme field is not allowed.",
      });
    }
  }

  const schemaVersion = input.schemaVersion ?? STOREFRONT_THEME_SCHEMA_VERSION;
  if (
    typeof schemaVersion !== "number" ||
    !Number.isInteger(schemaVersion) ||
    !SUPPORTED_STOREFRONT_THEME_SCHEMA_VERSIONS.includes(
      schemaVersion as (typeof SUPPORTED_STOREFRONT_THEME_SCHEMA_VERSIONS)[number],
    )
  ) {
    issues.push({
      field: "theme.schemaVersion",
      message: `Unsupported theme schema version ${String(schemaVersion)}.`,
    });
  }

  const preset = input.preset;
  if (
    typeof preset !== "string" ||
    !STOREFRONT_THEME_PRESET_IDS.includes(preset as StorefrontThemePresetId)
  ) {
    issues.push({
      field: "theme.preset",
      message: "Theme preset must be a supported baseline preset.",
    });
  }

  if (!isRecord(input.colors)) {
    issues.push({
      field: "theme.colors",
      message: "Theme colors are required.",
    });
  } else {
    const colorsInput = input.colors;
    assertAllowedKeys(colorsInput, ALLOWED_COLOR_KEYS, "theme.colors", issues);

    const missingColorTokens = STOREFRONT_THEME_COLOR_TOKENS.filter(
      (token) => !(token in colorsInput),
    );
    for (const token of missingColorTokens) {
      issues.push({
        field: `theme.colors.${token}`,
        message: `${token} color token is required.`,
      });
    }

    if (missingColorTokens.length === 0) {
      try {
        const colors = STOREFRONT_THEME_COLOR_TOKENS.reduce(
          (accumulator, token) => {
            accumulator[token] = parseHexColor(
              colorsInput[token],
              `theme.colors.${token}`,
            );
            return accumulator;
          },
          {} as Record<StorefrontThemeColorToken, string>,
        );

        validateContrast(
          colors.text,
          colors.background,
          "theme.colors.text",
          4.5,
          issues,
        );
        validateContrast(
          colors.primary,
          colors.background,
          "theme.colors.primary",
          3,
          issues,
        );
      } catch (error) {
        if (error instanceof StorefrontThemeValidationError) {
          issues.push({
            field: error.field ?? "theme.colors",
            message: error.message,
          });
        } else {
          throw error;
        }
      }
    }
  }

  if (!isRecord(input.typography)) {
    issues.push({
      field: "theme.typography",
      message: "Theme typography is required.",
    });
  } else {
    assertAllowedKeys(
      input.typography,
      ALLOWED_TYPOGRAPHY_KEYS,
      "theme.typography",
      issues,
    );

    const body = input.typography.body;
    if (
      typeof body !== "string" ||
      !STOREFRONT_THEME_BODY_FONTS.includes(body as StorefrontThemeBodyFont)
    ) {
      issues.push({
        field: "theme.typography.body",
        message: "Body font must be an approved typography preset.",
      });
    }

    const display = input.typography.display;
    if (
      typeof display !== "string" ||
      !STOREFRONT_THEME_DISPLAY_FONTS.includes(
        display as StorefrontThemeDisplayFont,
      )
    ) {
      issues.push({
        field: "theme.typography.display",
        message: "Display font must be an approved typography preset.",
      });
    }
  }

  if (input.logo !== undefined) {
    if (input.logo === null) {
      // Clearing the logo is allowed at the API layer; omit from persisted theme.
    } else if (!isRecord(input.logo)) {
      issues.push({
        field: "theme.logo",
        message: "Logo must be an object when provided.",
      });
    } else {
      assertAllowedKeys(input.logo, ALLOWED_LOGO_KEYS, "theme.logo", issues);

      const publicDerivativeId = input.logo.publicDerivativeId;
      if (
        typeof publicDerivativeId !== "string" ||
        !PUBLIC_DERIVATIVE_ID_PATTERN.test(publicDerivativeId)
      ) {
        issues.push({
          field: "theme.logo.publicDerivativeId",
          message: "Logo must reference an approved public media derivative ID.",
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new StorefrontThemeValidationError(
      "Theme draft validation failed.",
      issues[0]?.field,
      issues,
    );
  }

  const theme: StorefrontThemeDraft = {
    schemaVersion: STOREFRONT_THEME_SCHEMA_VERSION,
    preset: input.preset as StorefrontThemePresetId,
    colors: STOREFRONT_THEME_COLOR_TOKENS.reduce(
      (accumulator, token) => {
        accumulator[token] = parseHexColor(
          (input.colors as Record<string, unknown>)[token],
          `theme.colors.${token}`,
        );
        return accumulator;
      },
      {} as Record<StorefrontThemeColorToken, string>,
    ),
    typography: {
      body: (input.typography as Record<string, unknown>).body as StorefrontThemeBodyFont,
      display: (input.typography as Record<string, unknown>)
        .display as StorefrontThemeDisplayFont,
    },
  };

  if (
    isRecord(input.logo) &&
    typeof input.logo.publicDerivativeId === "string"
  ) {
    theme.logo = {
      publicDerivativeId: input.logo.publicDerivativeId,
    };
  }

  return theme;
}

export function normalizePersistedStorefrontTheme(
  value: Record<string, unknown> | undefined,
): StorefrontThemeDraft | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }

  try {
    return validateStorefrontThemeDraftInput({
      schemaVersion: value.schemaVersion ?? STOREFRONT_THEME_SCHEMA_VERSION,
      preset: value.preset,
      colors: value.colors,
      typography: normalizeLegacyTypography(value.typography),
      logo: value.logo,
    });
  } catch {
    return null;
  }
}

function normalizeLegacyTypography(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  if ("body" in value || "display" in value) {
    return value;
  }

  const legacyFontFamily = value.fontFamily;
  if (typeof legacyFontFamily === "string") {
    return {
      body: legacyFontFamily.toLowerCase().includes("inter")
        ? "inter"
        : "system-ui",
      display: "young-serif",
    };
  }

  return value;
}

export function storefrontThemeToRecord(
  theme: StorefrontThemeDraft,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    schemaVersion: theme.schemaVersion,
    preset: theme.preset,
    colors: { ...theme.colors },
    typography: { ...theme.typography },
  };

  if (theme.logo?.publicDerivativeId) {
    record.logo = { publicDerivativeId: theme.logo.publicDerivativeId };
  }

  return record;
}
