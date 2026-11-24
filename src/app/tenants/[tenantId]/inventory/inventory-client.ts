"use client";

import type { CostSource, CostTaxBasis, ItemCostStatus } from "@/lib/inventory/cost-completeness";
import { inventoryErrorText } from "@/lib/inventory/error-copy";
import type { Dependency } from "@/lib/inventory/errors";
import type { QuantityKind } from "@/lib/inventory/standard-units";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { type StaffLocale, type StaffUiCopyKey, staffUiCopy } from "@/lib/staff/locale";

/* QOS-195 client helpers shared by the inventory screens: API calls with
   typed error codes, localised names and labels. No local storage and no
   sample data: every value shown comes from the inventory API. */

export type InventoryApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; field: string | null; dependencies?: Dependency[] };

export async function inventoryApi<T>(url: string, init?: { method: string; body: unknown }): Promise<InventoryApiResult<T>> {
  try {
    const response = await staffApiFetch(
      url,
      init ? { method: init.method, body: JSON.stringify(init.body) } : {},
    );
    const payload = (await response.json().catch(() => ({}))) as {
      code?: string;
      field?: string;
      dependencies?: Dependency[];
    };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: payload.code ?? null,
        field: payload.field ?? null,
        ...(Array.isArray(payload.dependencies) ? { dependencies: payload.dependencies } : {}),
      };
    }
    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, status: 0, code: null, field: null };
  }
}

export function inventoryFailureText(
  locale: StaffLocale,
  failure: { status: number; code: string | null },
  fallback: StaffUiCopyKey = "inventorySaveError",
) {
  if (failure.status === 409 && !failure.code) {
    return staffUiCopy(locale, "versionConflict");
  }
  return inventoryErrorText(locale, failure.code, staffUiCopy(locale, fallback));
}

export const TAX_BASIS_LABEL: Record<CostTaxBasis, StaffUiCopyKey> = {
  net: "taxBasisNet",
  gross: "taxBasisGross",
  unconfirmed: "taxBasisUnconfirmed",
};

export const COST_SOURCE_LABEL: Record<CostSource, StaffUiCopyKey> = {
  manual: "costSourceManual",
  supplier_quote: "costSourceSupplierQuote",
  invoice: "costSourceInvoice",
};

export const COST_STATUS_LABEL: Record<ItemCostStatus, StaffUiCopyKey> = {
  known: "costKnown",
  unknown: "costUnknown",
  known_not_convertible: "costNotConvertible",
};

/** Localised name of a category by public id, or null when the item has none. */
export function categoryName(
  locale: StaffLocale,
  categories: ReadonlyArray<{ publicId: string; nameEn: string; nameAr: string | null }>,
  publicId: string | null,
) {
  const category = publicId ? categories.find((entry) => entry.publicId === publicId) : undefined;
  return category ? localName(locale, category.nameEn, category.nameAr) : null;
}

export const QUANTITY_KIND_LABEL: Record<QuantityKind, StaffUiCopyKey> = {
  mass: "quantityKindMass",
  volume: "quantityKindVolume",
  count: "quantityKindCount",
  pack: "quantityKindPack",
};

/** Arabic name when the locale is Arabic and one exists; the English name otherwise. */
export function localName(locale: StaffLocale, nameEn: string, nameAr: string | null) {
  if (locale === "ar" && nameAr) {
    return { text: nameAr, dir: "rtl" as const };
  }
  return { text: nameEn, dir: locale === "ar" ? ("ltr" as const) : undefined };
}

export function inventoryPath(tenantId: string, suffix = "") {
  return `/tenants/${tenantId}/inventory${suffix}`;
}
