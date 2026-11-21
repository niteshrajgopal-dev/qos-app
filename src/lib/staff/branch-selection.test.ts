import { describe, expect, it } from "vitest";

import {
  ALL_BRANCHES,
  branchPreferenceStorageKey,
  defaultBranchSelection,
  isAllBranchesAllowed,
  type PermittedBranch,
  REQUESTED_BUSINESS_BRANCH_LABELS,
  resolveBranchSelection,
  withBranchParam,
} from "@/lib/staff/branch-selection";

function branch(publicId: string, name = publicId): PermittedBranch {
  return { publicId, name, status: "active", timezone: "Asia/Dubai", currency: "AED" };
}

const HBZ = branch("loc_quotes_hbz", "HBZ Stadium");
const HCT = branch("loc_quotes_hct", "HCT Academic City");

describe("All branches eligibility", () => {
  it("is never offered to a user with a single location scope", () => {
    expect(isAllBranchesAllowed("user", 1)).toBe(false);
  });

  it("is offered to users with several scopes and to administrators", () => {
    expect(isAllBranchesAllowed("user", 2)).toBe(true);
    expect(isAllBranchesAllowed("administrator", 1)).toBe(true);
  });

  it("is not offered when nothing is permitted", () => {
    expect(isAllBranchesAllowed("administrator", 0)).toBe(false);
    expect(isAllBranchesAllowed("user", 0)).toBe(false);
  });
});

describe("defaultBranchSelection", () => {
  it("starts administrators on All branches and users on their first branch", () => {
    expect(defaultBranchSelection("administrator", [HBZ, HCT], true)).toBe(ALL_BRANCHES);
    expect(defaultBranchSelection("user", [HCT, HBZ], true)).toBe(HCT.publicId);
    expect(defaultBranchSelection("user", [], false)).toBeNull();
  });
});

describe("resolveBranchSelection", () => {
  const user = { role: "user" as const, branches: [HBZ], allBranchesAllowed: false };
  const admin = { role: "administrator" as const, branches: [HBZ, HCT], allBranchesAllowed: true };

  it("uses a permitted URL value before the stored preference", () => {
    expect(resolveBranchSelection([HCT.publicId, HBZ.publicId], admin)).toEqual({
      selection: HCT.publicId,
      rejected: null,
    });
  });

  it("falls back to the stored preference when the URL value is not permitted", () => {
    expect(resolveBranchSelection(["loc_other_tenant", HCT.publicId], admin)).toEqual({
      selection: HCT.publicId,
      rejected: "loc_other_tenant",
    });
  });

  it("falls back to the first permitted branch for a user and reports the refusal", () => {
    expect(resolveBranchSelection([HCT.publicId, null], user)).toEqual({
      selection: HBZ.publicId,
      rejected: HCT.publicId,
    });
  });

  it("refuses All branches for a single-scope user", () => {
    expect(resolveBranchSelection([ALL_BRANCHES], user)).toEqual({
      selection: HBZ.publicId,
      rejected: ALL_BRANCHES,
    });
  });

  it("falls back to All branches for administrators", () => {
    expect(resolveBranchSelection(["loc_unknown"], admin)).toEqual({
      selection: ALL_BRANCHES,
      rejected: "loc_unknown",
    });
  });

  it("ignores empty candidates without reporting them", () => {
    expect(resolveBranchSelection([null, undefined, ""], user)).toEqual({
      selection: HBZ.publicId,
      rejected: null,
    });
  });

  it("returns no selection when nothing is permitted", () => {
    expect(
      resolveBranchSelection([HBZ.publicId], {
        role: "user",
        branches: [],
        allBranchesAllowed: false,
      }),
    ).toEqual({ selection: null, rejected: HBZ.publicId });
  });
});

describe("withBranchParam", () => {
  it("adds or replaces the branch parameter and keeps the rest of the href", () => {
    expect(withBranchParam("/tenants/t/inventory", "loc_a")).toBe("/tenants/t/inventory?branch=loc_a");
    expect(withBranchParam("/tenants/t/catalogue?productArchived=1#list", "all")).toBe(
      "/tenants/t/catalogue?productArchived=1&branch=all#list",
    );
    expect(withBranchParam("/tenants/t?branch=old", "loc_b")).toBe("/tenants/t?branch=loc_b");
    expect(withBranchParam("/tenants/t", null)).toBe("/tenants/t");
  });

  it("encodes values so a branch id cannot inject other parameters", () => {
    expect(withBranchParam("/tenants/t", "a&role=administrator")).toBe(
      "/tenants/t?branch=a%26role%3Dadministrator",
    );
  });
});

describe("requested business branch labels", () => {
  it("lists Dubai, Al Ain and Azur Cafe as unmapped with no location", () => {
    expect(REQUESTED_BUSINESS_BRANCH_LABELS.map((label) => label.label)).toEqual([
      "Dubai",
      "Al Ain",
      "Azur Cafe",
    ]);
    for (const label of REQUESTED_BUSINESS_BRANCH_LABELS) {
      expect(label.mappingStatus).toBe("unmapped");
      expect(label.locationPublicId).toBeNull();
    }
  });

  it("keys the stored preference by tenant", () => {
    expect(branchPreferenceStorageKey("t-1")).toBe("qos-staff-branch:t-1");
  });
});
