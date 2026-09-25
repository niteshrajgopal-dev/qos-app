import { describe, expect, it } from "vitest";

import {
  activeStaffNavIdFromPath,
  staffNavHref,
  staffNavItemById,
} from "@/lib/staff/nav";

const tenantId = "0fe2c09b-e07e-4c0c-a3e1-254773eed5b9";

describe("staffNavHref", () => {
  it("maps ready destinations onto existing staff routes", () => {
    expect(staffNavHref(tenantId, "home")).toBe(`/tenants/${tenantId}`);
    expect(staffNavHref(tenantId, "catalogue")).toBe(
      `/tenants/${tenantId}/catalogue`,
    );
    expect(staffNavHref(tenantId, "menus")).toBe(
      `/tenants/${tenantId}/catalogue/menus`,
    );
    expect(staffNavHref(tenantId, "modifiers")).toBe(
      `/tenants/${tenantId}/catalogue/modifier-groups`,
    );
    expect(staffNavHref(tenantId, "import")).toBe(
      `/tenants/${tenantId}/catalogue/import`,
    );
    expect(staffNavHref(tenantId, "store")).toBe(
      `/tenants/${tenantId}/channels/online-store`,
    );
    expect(staffNavHref(tenantId, "locations")).toBe(
      `/tenants/${tenantId}/locations`,
    );
    expect(staffNavHref(tenantId, "channels")).toBe(
      `/tenants/${tenantId}/channels`,
    );
    expect(staffNavHref(tenantId, "team")).toBe(`/tenants/${tenantId}/team`);
    expect(staffNavHref(tenantId, "access")).toBe(
      `/tenants/${tenantId}/staff/access-requests`,
    );
    expect(staffNavHref(tenantId, "audit")).toBe(
      `/tenants/${tenantId}/staff/audit`,
    );
    expect(staffNavHref(tenantId, "orders")).toBe(
      `/tenants/${tenantId}/orders`,
    );
    expect(staffNavHref(tenantId, "customers")).toBe(
      `/tenants/${tenantId}/customers`,
    );
    expect(staffNavHref(tenantId, "integrations")).toBe(
      `/tenants/${tenantId}/integrations`,
    );
    expect(staffNavHref(tenantId, "analytics")).toBe(
      `/tenants/${tenantId}/analytics`,
    );
    expect(staffNavHref(tenantId, "settings")).toBe(
      `/tenants/${tenantId}/settings`,
    );
    expect(staffNavHref(tenantId, "pos")).toBe(
      `/tenants/${tenantId}/channels/pos`,
    );
    expect(staffNavHref(tenantId, "categories")).toBe(
      `/tenants/${tenantId}/catalogue/categories`,
    );
  });
});

describe("staffNavItemById", () => {
  it("keeps the platform nav order from the design system", () => {
    expect(staffNavItemById("home")?.label).toBe("Home");
    expect(staffNavItemById("orders")?.availability).toBe("ready");
    expect(staffNavItemById("catalogue")?.availability).toBe("ready");
    expect(staffNavItemById("integrations")?.availability).toBe("ready");
    expect(staffNavItemById("pos")?.availability).toBe("ready");
    expect(staffNavItemById("categories")?.availability).toBe("ready");
    expect(staffNavItemById("menus")?.label).toBe("Menus");
  });
});

describe("activeStaffNavIdFromPath", () => {
  it("selects the most specific nav item for the current path", () => {
    expect(activeStaffNavIdFromPath(`/tenants/${tenantId}`)).toBe("home");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/catalogue/products/new`),
    ).toBe("catalogue");
    expect(
      activeStaffNavIdFromPath(
        `/tenants/${tenantId}/catalogue/menus/men_demo/edit`,
      ),
    ).toBe("menus");
    expect(
      activeStaffNavIdFromPath(
        `/tenants/${tenantId}/catalogue/modifier-groups`,
      ),
    ).toBe("modifiers");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/channels/online-store`),
    ).toBe("store");
    expect(
      activeStaffNavIdFromPath(
        `/tenants/${tenantId}/locations/loc_quotes_hbz/availability`,
      ),
    ).toBe("locations");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/staff/audit`),
    ).toBe("audit");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/staff/access-requests`),
    ).toBe("access");
    expect(activeStaffNavIdFromPath(`/tenants/${tenantId}/team`)).toBe("team");
    expect(activeStaffNavIdFromPath(`/tenants/${tenantId}/channels`)).toBe(
      "channels",
    );
    expect(activeStaffNavIdFromPath(`/tenants/${tenantId}/orders`)).toBe(
      "orders",
    );
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/catalogue/categories`),
    ).toBe("categories");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/channels/pos`),
    ).toBe("pos");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/integrations`),
    ).toBe("integrations");
  });
});
