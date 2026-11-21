import { describe, expect, it } from "vitest";

import { StaffAuthorizationError } from "@/lib/staff/auth";
import {
  ALL_BRANCHES,
  assertOperationalBranch,
  assertReadableBranch,
  assertWarehouseBelongsToBranch,
  type PermittedBranch,
  WarehouseGuardNotImplementedError,
} from "@/lib/staff/branch-context";

const HBZ: PermittedBranch = {
  publicId: "loc_quotes_hbz",
  name: "HBZ Stadium",
  status: "active",
  timezone: "Asia/Dubai",
  currency: "AED",
};

function expectForbidden(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StaffAuthorizationError);
    expect((error as StaffAuthorizationError).statusCode).toBe(403);
    return;
  }
  throw new Error("expected a StaffAuthorizationError");
}

describe("assertOperationalBranch", () => {
  it("rejects All branches even for a caller who may read it", () => {
    expectForbidden(() => assertOperationalBranch(ALL_BRANCHES, [HBZ]));
  });

  it("rejects a missing selection", () => {
    expectForbidden(() => assertOperationalBranch(null, [HBZ]));
    expectForbidden(() => assertOperationalBranch(undefined, [HBZ]));
    expectForbidden(() => assertOperationalBranch("", [HBZ]));
  });

  it("rejects a branch outside the permitted list", () => {
    expectForbidden(() => assertOperationalBranch("loc_quotes_hct", [HBZ]));
    expectForbidden(() => assertOperationalBranch("loc_quotes_hbz", []));
  });

  it("returns the permitted branch for one explicit selection", () => {
    expect(assertOperationalBranch("loc_quotes_hbz", [HBZ])).toEqual(HBZ);
  });
});

describe("assertReadableBranch", () => {
  it("accepts All branches only when the context allows it", () => {
    expect(assertReadableBranch(ALL_BRANCHES, { branches: [HBZ], allBranchesAllowed: true })).toBe(
      ALL_BRANCHES,
    );
    expectForbidden(() =>
      assertReadableBranch(ALL_BRANCHES, { branches: [HBZ], allBranchesAllowed: false }),
    );
  });

  it("rejects a location outside the permitted list", () => {
    expectForbidden(() =>
      assertReadableBranch("loc_quotes_hct", { branches: [HBZ], allBranchesAllowed: true }),
    );
  });
});

describe("assertWarehouseBelongsToBranch", () => {
  it("fails closed until warehouses exist", () => {
    expect(() => assertWarehouseBelongsToBranch("wh_any", HBZ)).toThrow(
      WarehouseGuardNotImplementedError,
    );
  });
});
