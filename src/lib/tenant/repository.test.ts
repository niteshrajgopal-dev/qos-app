import { describe, expect, it } from "vitest";

import { validateCreateTenantHierarchyInput } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";
import { TenantValidationError } from "@/lib/tenant/types";

describe("validateCreateTenantHierarchyInput", () => {
  it("accepts complete tenant hierarchy input", () => {
    expect(() =>
      validateCreateTenantHierarchyInput(quotesTenantFixture()),
    ).not.toThrow();
  });

  it("rejects missing business profile inputs", () => {
    const input = quotesTenantFixture();
    input.tenant.baseCurrency = "";

    expect(() => validateCreateTenantHierarchyInput(input)).toThrow(
      TenantValidationError,
    );
  });

  it("rejects invalid currency codes", () => {
    const input = flowerTenantFixture();
    input.tenant.baseCurrency = "AE";

    expect(() => validateCreateTenantHierarchyInput(input)).toThrow(
      /3-letter code/,
    );
  });

  it("rejects missing location parent fields", () => {
    const input = quotesTenantFixture();
    input.location.slug = "   ";

    expect(() => validateCreateTenantHierarchyInput(input)).toThrow(
      /location.slug/,
    );
  });
});
