import { describe, expect, it } from "vitest";

import { resolveStaffDestinationAfterSignIn } from "@/lib/staff/post-sign-in";

describe("resolveStaffDestinationAfterSignIn", () => {
  it("sends a single-membership staff user to that tenant home", () => {
    expect(
      resolveStaffDestinationAfterSignIn([
        {
          tenantId: "tenant-quotes",
          tenantPublicId: "ten_quotes_dev",
          tenantName: "Quotes",
          membershipId: "mem-1",
          role: "administrator",
        },
      ]),
    ).toBe("/tenants/tenant-quotes");
  });

  it("sends multi-membership staff to the business picker", () => {
    expect(
      resolveStaffDestinationAfterSignIn([
        {
          tenantId: "tenant-quotes",
          tenantPublicId: "ten_quotes_dev",
          tenantName: "Quotes",
          membershipId: "mem-1",
          role: "administrator",
        },
        {
          tenantId: "tenant-flowers",
          tenantPublicId: "ten_flowers_dev",
          tenantName: "Petal & Stem",
          membershipId: "mem-2",
          role: "user",
        },
      ]),
    ).toBe("/staff/businesses");
  });

  it("sends staff with no memberships to the business picker", () => {
    expect(resolveStaffDestinationAfterSignIn([])).toBe("/staff/businesses");
  });
});
