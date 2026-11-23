import type { GraphUnit } from "@/lib/inventory/conversion-graph";
import type { PreviewUnit } from "@/lib/inventory/conversion-preview";
import type { QuantityKind, StandardUnitCode } from "@/lib/inventory/standard-units";

/* Unit records shared by the pure graph and preview tests. */
export function unit(
  code: string,
  quantityKind: QuantityKind,
  options: { standard?: boolean; decimalPlaces?: number; status?: "active" | "archived" } = {},
): PreviewUnit {
  return {
    id: `id-${code}`,
    publicId: `unit_${code}_00000000`,
    code,
    nameEn: code,
    nameAr: code,
    quantityKind,
    standardCode: options.standard ? (code as StandardUnitCode) : null,
    decimalPlaces: options.decimalPlaces ?? 0,
    status: options.status ?? "active",
  } satisfies GraphUnit & PreviewUnit;
}

export const micros = (text: string) => {
  const [integer, fraction = ""] = text.split(".");
  return BigInt(integer + fraction.padEnd(6, "0"));
};
