import type { BusinessProfile, StaffRole } from "@/lib/tenant/types";

export class OnboardingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingValidationError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPORTED_PHASE1_LOCALES = new Set(["en", "ar"]);
const SUPPORTED_PHASE1_CURRENCIES = new Set(["AED"]);

export type ProvisionBusinessInput = {
  businessName: string;
  businessProfile: BusinessProfile;
  brandName: string;
  locationName: string;
  locationTimezone: string;
  administratorEmail: string;
  baseCurrency: string;
  defaultLocale: string;
  supportedLocales: string[];
  administratorRole?: StaffRole;
};

function assertNonEmpty(value: string, field: string) {
  if (!value.trim()) {
    throw new OnboardingValidationError(`${field} is required.`);
  }
}

export function normalizeProvisionBusinessInput(
  input: ProvisionBusinessInput,
): ProvisionBusinessInput {
  const administratorRole = input.administratorRole ?? "administrator";

  if (administratorRole !== "administrator" && administratorRole !== "user") {
    throw new OnboardingValidationError(
      "Only Administrator or User staff roles are allowed.",
    );
  }

  const normalized: ProvisionBusinessInput = {
    businessName: input.businessName.trim(),
    businessProfile: input.businessProfile,
    brandName: input.brandName.trim(),
    locationName: input.locationName.trim(),
    locationTimezone: input.locationTimezone.trim(),
    administratorEmail: input.administratorEmail.trim().toLowerCase(),
    baseCurrency: input.baseCurrency.trim().toUpperCase(),
    defaultLocale: input.defaultLocale.trim().toLowerCase(),
    supportedLocales: [...new Set(input.supportedLocales.map((l) => l.trim().toLowerCase()))],
    administratorRole,
  };

  assertNonEmpty(normalized.businessName, "businessName");
  assertNonEmpty(normalized.brandName, "brandName");
  assertNonEmpty(normalized.locationName, "locationName");
  assertNonEmpty(normalized.locationTimezone, "locationTimezone");
  assertNonEmpty(normalized.administratorEmail, "administratorEmail");

  if (!EMAIL_PATTERN.test(normalized.administratorEmail)) {
    throw new OnboardingValidationError("administratorEmail is invalid.");
  }

  if (!SUPPORTED_PHASE1_CURRENCIES.has(normalized.baseCurrency)) {
    throw new OnboardingValidationError(
      "Only AED is supported for Phase 1 onboarding.",
    );
  }

  if (normalized.businessProfile !== "hospitality" && normalized.businessProfile !== "generic_retail") {
    throw new OnboardingValidationError("businessProfile is invalid.");
  }

  if (normalized.supportedLocales.length === 0) {
    throw new OnboardingValidationError("supportedLocales must not be empty.");
  }

  for (const locale of normalized.supportedLocales) {
    if (!SUPPORTED_PHASE1_LOCALES.has(locale)) {
      throw new OnboardingValidationError(
        `Unsupported locale "${locale}" for Phase 1 onboarding.`,
      );
    }
  }

  if (!normalized.supportedLocales.includes(normalized.defaultLocale)) {
    throw new OnboardingValidationError(
      "defaultLocale must be included in supportedLocales.",
    );
  }

  return normalized;
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function buildPublicId(prefix: string, label: string) {
  const slug = slugify(label) || prefix;
  const suffix = crypto.randomUUID().split("-")[0];
  return `${prefix}_${slug}_${suffix}`;
}
