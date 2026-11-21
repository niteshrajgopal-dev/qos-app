import { describe, expect, it } from "vitest";

import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { assertCreateStatus, type Values } from "@/lib/workbook/apply/handlers/shared";

function values(status?: string | null): Values {
  const map: Values = new Map();
  if (status !== undefined) map.set("status", status);
  return map;
}

describe("assertCreateStatus", () => {
  it("allows a missing status, the listed statuses, and import draft on active-only records", () => {
    expect(() => assertCreateStatus(values(), ["draft"])).not.toThrow();
    expect(() => assertCreateStatus(values("draft"), ["draft"])).not.toThrow();
    expect(() => assertCreateStatus(values("active"), ["active"])).not.toThrow();
    expect(() => assertCreateStatus(values("draft"), ["active"])).not.toThrow();
    expect(() => assertCreateStatus(values(null), ["active"])).not.toThrow();
  });

  it("refuses a status the service cannot create", () => {
    try {
      assertCreateStatus(values("active"), ["draft"]);
      throw new Error("expected ApplyUnitError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyUnitError);
      expect((error as ApplyUnitError).failure).toMatchObject({
        code: "service_validation",
        field: "status",
        reason: "status_requires_publication",
        message: "New records cannot be created as active.",
      });
    }
    try {
      assertCreateStatus(values("archived"), ["active"]);
      throw new Error("expected ApplyUnitError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyUnitError);
      expect((error as ApplyUnitError).failure).toMatchObject({
        code: "service_validation",
        reason: "status_requires_publication",
        message: "New records cannot be created as archived.",
      });
    }
  });
});
