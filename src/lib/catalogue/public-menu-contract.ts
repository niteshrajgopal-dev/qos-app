import type { MenuLiveSnapshotPayload } from "@/db/schema";

export const PUBLIC_MENU_CONTRACT_VERSION = 1;

export type PublicMenuLocale = "en" | "ar";

export type PublicMenuProductPrice = {
  amountMinor: number;
  currency: string;
  inheritanceMode: "inherited" | "override";
};

export type PublicMenuProduct = {
  productPublicId: string;
  sortOrder: number;
  displayName: string;
  description: string | null;
  price: PublicMenuProductPrice;
  mediaAssetId: string | null;
  eligibility: {
    available: true;
  };
};

export type PublicMenuSection = {
  publicId: string;
  sortOrder: number;
  displayName: string;
  description: string | null;
  products: PublicMenuProduct[];
};

export type PublicMenuResponse = {
  contractVersion: typeof PUBLIC_MENU_CONTRACT_VERSION;
  publicKey: string;
  tenantPublicId: string;
  menuPublicId: string;
  locationPublicId: string;
  releaseVersion: number;
  locale: PublicMenuLocale;
  currency: string;
  displayName: string;
  description: string | null;
  sections: PublicMenuSection[];
};

export class PublicMenuContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "PublicMenuContractError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function parsePublicMenuLocale(value: string | null): PublicMenuLocale {
  if (value === "en" || value === "ar") {
    return value;
  }

  throw new PublicMenuContractError(
    "locale query parameter must be explicitly en or ar.",
    400,
    "locale",
  );
}

function pickLocalizedText(
  translations: Record<string, { displayName: string; description: string | null }>,
  locale: PublicMenuLocale,
) {
  const localized = translations[locale];
  return {
    displayName: localized?.displayName ?? "",
    description: localized?.description ?? null,
  };
}

export function toPublicMenuResponse(input: {
  publicKey: string;
  tenantPublicId: string;
  locale: PublicMenuLocale;
  snapshot: MenuLiveSnapshotPayload;
}): PublicMenuResponse {
  const menuText = pickLocalizedText(input.snapshot.translations, input.locale);
  const currency =
    input.snapshot.sections
      .flatMap((section) => section.products)
      .find((product) => product.price.currency)?.price.currency ?? "AED";

  return {
    contractVersion: PUBLIC_MENU_CONTRACT_VERSION,
    publicKey: input.publicKey,
    tenantPublicId: input.tenantPublicId,
    menuPublicId: input.snapshot.menuPublicId,
    locationPublicId: input.snapshot.locationPublicId,
    releaseVersion: input.snapshot.version,
    locale: input.locale,
    currency,
    displayName: menuText.displayName,
    description: menuText.description,
    sections: input.snapshot.sections.map((section) => {
      const sectionText = pickLocalizedText(section.translations, input.locale);

      return {
        publicId: section.publicId,
        sortOrder: section.sortOrder,
        displayName: sectionText.displayName,
        description: sectionText.description,
        products: section.products.map((product) => {
          const productText = pickLocalizedText(
            product.translations,
            input.locale,
          );

          return {
            productPublicId: product.productPublicId,
            sortOrder: product.sortOrder,
            displayName: productText.displayName,
            description: productText.description,
            price: product.price,
            mediaAssetId: product.mediaAssetId ?? null,
            eligibility: {
              available: true,
            },
          };
        }),
      };
    }),
  };
}

export function assertPublicMenuResponseIsAllowlisted(
  response: PublicMenuResponse,
) {
  const serialized = JSON.stringify(response);
  const forbiddenPatterns = [
    "internalName",
    "staff",
    "recipe",
    "supplier",
    "cost",
    "draft",
    "blob",
    "credential",
    "tenantId",
    "approvedBySubject",
  ];

  for (const pattern of forbiddenPatterns) {
    if (serialized.toLowerCase().includes(pattern.toLowerCase())) {
      throw new Error(`Public menu response leaked forbidden field: ${pattern}`);
    }
  }
}
