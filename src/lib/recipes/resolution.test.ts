import { describe, expect, it } from "vitest";

import { rational, toDecimalString } from "@/lib/inventory/quantity-math";
import { micros, unit } from "@/lib/inventory/test-units";
import {
  type ResolutionInput,
  type ResolutionLink,
  type ResolutionRecipe,
  type ResolutionVersion,
  resolveConsumption,
} from "@/lib/recipes/resolution";

const g = unit("g", "mass", { standard: true });
const kg = unit("kg", "mass", { standard: true, decimalPlaces: 3 });
const ml = unit("ml", "volume", { standard: true });
const l = unit("l", "volume", { standard: true, decimalPlaces: 3 });
const piece = unit("piece", "count", { standard: true });
const cup = unit("cup", "volume");
const portion = unit("portion", "count");
const bottle = unit("bottle", "pack");
const UNITS = [g, kg, ml, l, piece, cup, portion, bottle];

const milk = { id: "item-milk", status: "active" as const, kind: "purchased" as const, storageUnitId: l.id };
const beans = { id: "item-beans", status: "active" as const, kind: "purchased" as const, storageUnitId: kg.id };
const syrup = { id: "item-syrup", status: "active" as const, kind: "prepared" as const, storageUnitId: l.id };
const water = { id: "item-water", status: "active" as const, kind: "purchased" as const, storageUnitId: bottle.id };

function version(overrides: Partial<ResolutionVersion> & { id: string; versionNumber: number }): ResolutionVersion {
  return {
    status: "approved",
    effectiveFrom: "2026-11-01",
    effectiveTo: null,
    yieldQuantityMicros: micros("4"),
    yieldUnitId: portion.id,
    lines: [
      { id: `${overrides.id}-milk`, itemId: milk.id, unitId: ml.id, quantityMicros: micros("1000"), status: "active" },
      { id: `${overrides.id}-beans`, itemId: beans.id, unitId: g.id, quantityMicros: micros("72"), status: "active" },
    ],
    ...overrides,
  };
}

const recipeLink: ResolutionLink = {
  id: "link-1",
  kind: "recipe",
  recipeId: "rec-latte",
  itemId: null,
  quantityMicros: null,
  unitId: null,
  effectiveFrom: "2026-11-01",
  effectiveTo: null,
};

function input(overrides: Partial<ResolutionInput> & { versions?: ResolutionVersion[] } = {}): ResolutionInput {
  const { versions, ...rest } = overrides;
  const recipe: ResolutionRecipe = {
    id: "rec-latte",
    kind: "sellable",
    status: "active",
    versions: versions ?? [version({ id: "v1", versionNumber: 1 })],
  };
  return {
    businessDate: "2026-11-10",
    soldQuantity: 1,
    variant: { status: "active", productStatus: "active", sellingQuantityBasis: "each" },
    links: [recipeLink],
    recipes: [recipe],
    items: [milk, beans, syrup, water],
    units: UNITS,
    rules: [],
    ...rest,
  };
}

describe("resolveConsumption: version selection", () => {
  const v1 = version({ id: "v1", versionNumber: 1, effectiveFrom: "2026-11-01", effectiveTo: "2026-11-15" });
  const v2 = version({ id: "v2", versionNumber: 2, effectiveFrom: "2026-11-15", effectiveTo: null });

  it.each([
    ["2026-11-01", 1],
    ["2026-11-10", 1],
    ["2026-11-14", 1],
    ["2026-11-15", 2],
    ["2027-01-01", 2],
  ])("selects exactly one approved version on %s (version %i)", (businessDate, expected) => {
    const result = resolveConsumption(input({ businessDate, versions: [v2, v1] }));
    expect(result).toMatchObject({ status: "resolved", kind: "recipe", versionNumber: expected });
  });

  it("is unresolved before the first approved version starts", () => {
    const links = [{ ...recipeLink, effectiveFrom: "2026-10-01" }];
    expect(resolveConsumption(input({ businessDate: "2026-10-31", versions: [v1, v2], links }))).toMatchObject({
      status: "unresolved",
      reason: "no_approved_version",
    });
  });

  it("never chooses a draft: draft only is draft_only, and a draft beside an approved version is ignored", () => {
    const draft = version({ id: "d", versionNumber: 1, status: "draft", effectiveFrom: null, effectiveTo: null });
    expect(resolveConsumption(input({ versions: [draft] }))).toMatchObject({ status: "unresolved", reason: "draft_only" });
    const draft2 = version({ id: "d2", versionNumber: 3, status: "draft", effectiveFrom: null, effectiveTo: null });
    expect(resolveConsumption(input({ versions: [draft2, v2, v1], businessDate: "2026-11-20" }))).toMatchObject({
      status: "resolved",
      versionNumber: 2,
      versionId: "v2",
    });
  });

  it("ignores discarded versions", () => {
    const discarded = version({ id: "x", versionNumber: 3, status: "discarded", effectiveFrom: null, effectiveTo: null });
    expect(resolveConsumption(input({ versions: [discarded, v1] }))).toMatchObject({ status: "resolved", versionNumber: 1 });
  });

  it("keeps the previous version while the next one is scheduled", () => {
    const scheduled = version({ id: "v2", versionNumber: 2, effectiveFrom: "2026-12-01" });
    const current = version({ id: "v1", versionNumber: 1, effectiveTo: "2026-12-01" });
    expect(resolveConsumption(input({ versions: [scheduled, current], businessDate: "2026-11-30" }))).toMatchObject({
      versionNumber: 1,
    });
    expect(resolveConsumption(input({ versions: [scheduled, current], businessDate: "2026-12-01" }))).toMatchObject({
      versionNumber: 2,
    });
  });

  it("is no_approved_version after the only approved version ended", () => {
    const ended = version({ id: "v1", versionNumber: 1, effectiveTo: "2026-11-05" });
    expect(resolveConsumption(input({ versions: [ended] }))).toMatchObject({ status: "unresolved", reason: "no_approved_version" });
  });

  it("refuses overlapping approved versions instead of picking one", () => {
    const a = version({ id: "a", versionNumber: 1, effectiveFrom: "2026-11-01", effectiveTo: null });
    const b = version({ id: "b", versionNumber: 2, effectiveFrom: "2026-11-05", effectiveTo: null });
    const result = resolveConsumption(input({ versions: [b, a] }));
    expect(result).toEqual({
      status: "unresolved",
      reason: "overlapping_versions",
      linkId: "link-1",
      detail: { versionNumbers: [1, 2] },
    });
  });

  it("does not resolve an archived recipe, a prepared family, an archived or weight-sold variant", () => {
    const archived = input();
    expect(
      resolveConsumption({ ...archived, recipes: [{ ...archived.recipes[0]!, status: "archived" }] }),
    ).toMatchObject({ reason: "recipe_archived" });
    expect(resolveConsumption({ ...archived, recipes: [{ ...archived.recipes[0]!, kind: "prepared" }] })).toMatchObject({
      reason: "recipe_not_sellable",
    });
    expect(
      resolveConsumption(input({ variant: { status: "archived", productStatus: "active", sellingQuantityBasis: null } })),
    ).toMatchObject({ reason: "variant_archived" });
    expect(
      resolveConsumption(input({ variant: { status: "active", productStatus: "active", sellingQuantityBasis: "weight" } })),
    ).toMatchObject({ reason: "weight_basis_unsupported" });
  });
});

describe("resolveConsumption: per-sale usage", () => {
  it("divides whole-yield quantities by the yield and converts to the storage unit exactly", () => {
    const result = resolveConsumption(input({ soldQuantity: 3 }));
    if (result.status !== "resolved") throw new Error("expected resolved");
    const [milkLine, beansLine] = result.lines;
    // 1000 ml for 4 portions = 250 ml = 0.25 l per sale; 3 sales = 0.75 l.
    expect(milkLine).toMatchObject({ status: "ok", storageUnitId: l.id });
    expect(milkLine!.perSale).toEqual(rational(BigInt(1), BigInt(4)));
    expect(milkLine!.total).toEqual(rational(BigInt(3), BigInt(4)));
    // 72 g for 4 portions = 18 g = 0.018 kg per sale.
    expect(beansLine!.perSale).toEqual(rational(BigInt(18), BigInt(1000)));
    expect(result.complete).toBe(true);
  });

  it("keeps a third exact and only rounds for display", () => {
    const thirds = version({
      id: "v1",
      versionNumber: 1,
      yieldQuantityMicros: micros("3"),
      lines: [{ id: "l", itemId: milk.id, unitId: l.id, quantityMicros: micros("1"), status: "active" }],
    });
    const result = resolveConsumption(input({ versions: [thirds] }));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.lines[0]!.perSale).toEqual(rational(BigInt(1), BigInt(3)));
    expect(toDecimalString(result.lines[0]!.perSale!, 3)).toBe("0.333");
  });

  it("uses the item's own rule live on the business date to reach the storage unit", () => {
    const cups = version({
      id: "v1",
      versionNumber: 1,
      yieldQuantityMicros: micros("2"),
      lines: [{ id: "l", itemId: milk.id, unitId: cup.id, quantityMicros: micros("1"), status: "active" }],
    });
    const rules = [
      { id: "r1", itemId: milk.id, fromUnitId: cup.id, toUnitId: ml.id, factorMicros: micros("240"), effectiveFrom: "2026-11-01", effectiveTo: "2026-11-20" },
      { id: "r2", itemId: milk.id, fromUnitId: cup.id, toUnitId: ml.id, factorMicros: micros("250"), effectiveFrom: "2026-11-20", effectiveTo: null },
      // Another item's rule never applies to milk.
      { id: "r3", itemId: beans.id, fromUnitId: cup.id, toUnitId: g.id, factorMicros: micros("90"), effectiveFrom: "2026-11-01", effectiveTo: null },
    ];
    const before = resolveConsumption(input({ versions: [cups], rules, businessDate: "2026-11-19" }));
    const after = resolveConsumption(input({ versions: [cups], rules, businessDate: "2026-11-20" }));
    if (before.status !== "resolved" || after.status !== "resolved") throw new Error("expected resolved");
    // Half a cup per sale: 120 ml = 0.12 l, then 125 ml = 0.125 l.
    expect(before.lines[0]!.perSale).toEqual(rational(BigInt(12), BigInt(100)));
    expect(after.lines[0]!.perSale).toEqual(rational(BigInt(1), BigInt(8)));
  });

  it("marks an incompatible unit as missing_conversion with no number, never a guess", () => {
    const grams = version({
      id: "v1",
      versionNumber: 1,
      lines: [
        { id: "l1", itemId: milk.id, unitId: g.id, quantityMicros: micros("500"), status: "active" },
        { id: "l2", itemId: beans.id, unitId: g.id, quantityMicros: micros("72"), status: "active" },
      ],
    });
    const result = resolveConsumption(input({ versions: [grams] }));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.complete).toBe(false);
    expect(result.lines[0]).toMatchObject({ status: "missing_conversion", perSale: null, total: null });
    expect(result.lines[1]).toMatchObject({ status: "ok" });
  });

  it("reports archived items and missing storage units per line", () => {
    const items = [{ ...milk, status: "archived" as const }, { ...beans, storageUnitId: null }];
    const result = resolveConsumption(input({ items }));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.lines.map((line) => line.status)).toEqual(["item_archived", "storage_unit_missing"]);
    expect(result.complete).toBe(false);
  });

  it("consumes a prepared item as itself and never explodes its own recipe", () => {
    const withSyrup = version({
      id: "v1",
      versionNumber: 1,
      yieldQuantityMicros: micros("10"),
      lines: [{ id: "l", itemId: syrup.id, unitId: ml.id, quantityMicros: micros("200"), status: "active" }],
    });
    const result = resolveConsumption(input({ versions: [withSyrup] }));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ itemId: syrup.id, prepared: true, status: "ok" });
    expect(result.lines[0]!.perSale).toEqual(rational(BigInt(2), BigInt(100)));
  });

  it("skips removed lines and refuses a version without active lines", () => {
    const removed = version({
      id: "v1",
      versionNumber: 1,
      lines: [{ id: "l", itemId: milk.id, unitId: ml.id, quantityMicros: micros("1"), status: "removed" }],
    });
    expect(resolveConsumption(input({ versions: [removed] }))).toMatchObject({ status: "unresolved", reason: "no_lines" });
  });

  it("refuses a sold quantity that is not a positive whole number", () => {
    expect(() => resolveConsumption(input({ soldQuantity: 0 }))).toThrow();
    expect(() => resolveConsumption(input({ soldQuantity: 1.5 }))).toThrow();
  });
});

describe("resolveConsumption: links", () => {
  const directLink: ResolutionLink = {
    id: "link-water",
    kind: "direct_stock",
    recipeId: null,
    itemId: water.id,
    quantityMicros: micros("1"),
    unitId: bottle.id,
    effectiveFrom: "2026-11-01",
    effectiveTo: null,
  };

  it("resolves a direct-stock link to its item quantity without any recipe", () => {
    const result = resolveConsumption(input({ links: [directLink], recipes: [], soldQuantity: 2 }));
    expect(result).toMatchObject({ status: "resolved", kind: "direct_stock", linkId: "link-water", complete: true });
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.lines[0]!.perSale).toEqual(rational(BigInt(1)));
    expect(result.lines[0]!.total).toEqual(rational(BigInt(2)));
  });

  it("leaves a direct-stock link unresolved when its unit does not convert to the storage unit", () => {
    const grams = { ...directLink, unitId: g.id, quantityMicros: micros("330") };
    expect(resolveConsumption(input({ links: [grams], recipes: [] }))).toMatchObject({
      status: "unresolved",
      reason: "missing_conversion",
      linkId: "link-water",
    });
  });

  it("is no_link without a live link and uses only the link live on the date", () => {
    const ended = { ...directLink, effectiveTo: "2026-11-05" };
    const next = { ...recipeLink, id: "link-2", effectiveFrom: "2026-11-05" };
    expect(resolveConsumption(input({ links: [] }))).toMatchObject({ reason: "no_link" });
    expect(resolveConsumption(input({ links: [ended, next], businessDate: "2026-11-04" }))).toMatchObject({
      kind: "direct_stock",
      linkId: "link-water",
    });
    expect(resolveConsumption(input({ links: [ended, next], businessDate: "2026-11-05" }))).toMatchObject({
      kind: "recipe",
      linkId: "link-2",
    });
  });

  it("refuses a recipe link and a direct-stock link live on the same date", () => {
    expect(resolveConsumption(input({ links: [recipeLink, directLink] }))).toEqual({
      status: "unresolved",
      reason: "overlapping_links",
      linkId: null,
      detail: { linkIds: ["link-1", "link-water"] },
    });
  });

  it("resolves two variants that share one family to the same version without copying it", () => {
    const shared = input();
    const other = { ...recipeLink, id: "link-other" };
    const first = resolveConsumption(shared);
    const second = resolveConsumption({ ...shared, links: [other] });
    expect(first).toMatchObject({ status: "resolved", recipeId: "rec-latte", versionId: "v1" });
    expect(second).toMatchObject({ status: "resolved", recipeId: "rec-latte", versionId: "v1" });
    expect(shared.recipes).toHaveLength(1);
  });
});
