import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { STANDARD_UNIT_CODES, STANDARD_UNITS, standardUnit } from "@/lib/inventory/standard-units";

describe("standard units", () => {
  it("lists exactly the codes the 0060 CHECK constraint allows", () => {
    const drizzleDir = path.join(process.cwd(), "drizzle");
    const file = readdirSync(drizzleDir).find((name) => name.startsWith("0060_"));
    expect(file).toBe("0060_inventory_units_items_conversions.sql");
    const sql = readFileSync(path.join(drizzleDir, file!), "utf8");
    const match = /"standard_code" IN \(([^)]+)\)/.exec(sql);
    expect(match).not.toBeNull();
    const codes = match![1]!.split(",").map((entry) => entry.trim().replace(/'/g, ""));
    expect(codes).toEqual([...STANDARD_UNIT_CODES]);
  });

  it("uses exact integer factors to each dimension base", () => {
    const factor = (code: string) => {
      const unit = standardUnit(code)!;
      return `${unit.toBase.numerator}/${unit.toBase.denominator}`;
    };
    expect(factor("mg")).toBe("1/1000");
    expect(factor("g")).toBe("1/1");
    expect(factor("kg")).toBe("1000/1");
    expect(factor("ml")).toBe("1/1");
    expect(factor("cl")).toBe("10/1");
    expect(factor("l")).toBe("1000/1");
    expect(factor("piece")).toBe("1/1");
    for (const unit of STANDARD_UNITS) {
      expect(typeof unit.toBase.numerator).toBe("bigint");
      expect(unit.toBase.numerator > BigInt(0) && unit.toBase.denominator > BigInt(0)).toBe(true);
    }
  });

  it("has English and Arabic names and default precision for every unit", () => {
    for (const unit of STANDARD_UNITS) {
      expect(unit.nameEn.trim()).not.toBe("");
      expect(unit.nameAr).toMatch(/[؀-ۿ]/);
      expect(unit.defaultDecimalPlaces).toBeGreaterThanOrEqual(0);
      expect(unit.defaultDecimalPlaces).toBeLessThanOrEqual(6);
    }
    expect(standardUnit("oz")).toBeNull();
    expect(standardUnit(null)).toBeNull();
  });
});
