import { describe, expect, it } from "vitest";

import { existsSync } from "node:fs";
import path from "node:path";

import { staffNavLabel, STAFF_UI_COPY } from "@/lib/staff/locale";
import {
  activeStaffNavIdFromPath,
  flattenStaffNavItems,
  isStaffMoreNavId,
  staffNavHref,
  staffNavItemById,
  STAFF_MORE_NAV_GROUPS,
  STAFF_NAV_GROUPS,
  STAFF_TOP_NAV,
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
    expect(staffNavHref(tenantId, "menu-extraction")).toBe(
      `/tenants/${tenantId}/catalogue/menu-extraction`,
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
    expect(staffNavHref(tenantId, "approvals")).toBe(
      `/tenants/${tenantId}/staff/translation-approvals`,
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
    expect(staffNavHref(tenantId, "ai-agents")).toBe(
      `/tenants/${tenantId}/settings/ai-agents`,
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

describe("portal header navigation", () => {
  it("puts the prototype's five destinations in the header", () => {
    expect(STAFF_TOP_NAV.map((item) => item.label)).toEqual([
      "Overview",
      "Orders",
      "Catalogue",
      "Menus",
      "Storefronts",
    ]);
  });

  it("resolves every header and More destination to a route", () => {
    const ids = [
      ...STAFF_TOP_NAV.map((item) => item.id),
      ...STAFF_MORE_NAV_GROUPS.flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ];

    for (const id of ids) {
      expect(staffNavHref(tenantId, id), id).not.toBeNull();
    }
  });

  it("never lists a header destination under More as well", () => {
    for (const item of STAFF_TOP_NAV) {
      expect(isStaffMoreNavId(item.id), item.id).toBe(false);
    }

    expect(isStaffMoreNavId("settings")).toBe(true);
    expect(isStaffMoreNavId("menu-extraction")).toBe(true);
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
      activeStaffNavIdFromPath(
        `/tenants/${tenantId}/staff/translation-approvals`,
      ),
    ).toBe("approvals");
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
      activeStaffNavIdFromPath(`/tenants/${tenantId}/catalogue/menu-extraction`),
    ).toBe("menu-extraction");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/channels/pos`),
    ).toBe("pos");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/integrations`),
    ).toBe("integrations");
    expect(
      activeStaffNavIdFromPath(`/tenants/${tenantId}/settings/ai-agents`),
    ).toBe("ai-agents");
    expect(activeStaffNavIdFromPath(`/tenants/${tenantId}/settings`)).toBe(
      "settings",
    );
  });
});

describe("Phase 2 destinations (QOS-192)", () => {
  const PHASE2 = {
    inventory: "/inventory",
    kitchen: "/kitchen",
    sales: "/sales",
    reports: "/reports",
    recipes: "/catalogue/recipes",
    branches: "/settings/branches",
  } as const;

  it("resolves each new destination to its entry page", () => {
    for (const [id, suffix] of Object.entries(PHASE2)) {
      expect(staffNavHref(tenantId, id), id).toBe(`/tenants/${tenantId}${suffix}`);
      expect(activeStaffNavIdFromPath(`/tenants/${tenantId}${suffix}`), id).toBe(id);
    }
  });

  it("points every header and More link at a page that exists", () => {
    const ids = [
      ...STAFF_TOP_NAV.map((item) => item.id),
      ...STAFF_MORE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id)),
    ];
    for (const id of ids) {
      const href = staffNavHref("[tenantId]", id)!;
      const page = path.join(process.cwd(), "src/app", href, "page.tsx");
      expect(existsSync(page), `${id} -> ${page}`).toBe(true);
    }
  });

  it("marks areas without services as soon and keeps Branches ready", () => {
    for (const id of ["kitchen", "sales", "reports"]) {
      expect(staffNavItemById(id)?.availability, id).toBe("soon");
    }
    expect(staffNavItemById("branches")?.availability).toBe("ready");
  });

  it("marks Recipes ready under Catalogue in the sidebar and under More now that QOS-198 serves it", () => {
    expect(staffNavItemById("recipes")?.availability).toBe("ready");
    const catalogueChildren = STAFF_NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === "catalogue")!.children!;
    expect(catalogueChildren).toContainEqual(expect.objectContaining({ id: "recipes", availability: "ready" }));
    const catalogueMore = STAFF_MORE_NAV_GROUPS.find((group) => group.items.some((item) => item.id === "recipes"))!;
    expect(catalogueMore.items).toContainEqual(expect.objectContaining({ id: "recipes", availability: "ready" }));
    for (const suffix of ["/catalogue/recipes", "/catalogue/recipes/new", "/catalogue/recipes/rec_x", "/catalogue/recipes/rec_x/versions/recv_x"]) {
      expect(activeStaffNavIdFromPath(`/tenants/${tenantId}${suffix}`)).toBe("recipes");
    }
  });

  it("marks Inventory ready in the sidebar and under More now that QOS-195 serves it", () => {
    expect(staffNavItemById("inventory")?.availability).toBe("ready");
    const inventoryGroup = STAFF_NAV_GROUPS.find((group) => group.label === "Inventory")!;
    expect(inventoryGroup.items[0]).toMatchObject({ id: "inventory", availability: "ready" });
    expect(inventoryGroup.items[0]!.children).toEqual([
      expect.objectContaining({ id: "inventory", availability: "ready" }),
      expect.objectContaining({ id: "kitchen", availability: "soon" }),
    ]);
    const more = STAFF_MORE_NAV_GROUPS.find((group) => group.label === "Inventory")!;
    expect(more.items).toEqual([
      expect.objectContaining({ id: "inventory", availability: "ready" }),
      expect.objectContaining({ id: "kitchen", availability: "soon" }),
    ]);
    for (const suffix of ["/inventory/units/new", "/inventory/items/item_x", "/inventory/units/unit_x/edit"]) {
      expect(activeStaffNavIdFromPath(`/tenants/${tenantId}${suffix}`)).toBe("inventory");
    }
  });

  it("files the new areas under More, never in the header", () => {
    for (const id of Object.keys(PHASE2)) {
      expect(isStaffMoreNavId(id), id).toBe(true);
    }
    expect(STAFF_MORE_NAV_GROUPS.map((group) => group.label)).toEqual([
      "Catalogue",
      "Inventory",
      "Finance",
      "Commerce",
      "Platform",
    ]);
  });

  it("keeps every Phase 1 destination at its existing route", () => {
    const phase1 = {
      home: "",
      orders: "/orders",
      catalogue: "/catalogue",
      menus: "/catalogue/menus",
      modifiers: "/catalogue/modifier-groups",
      import: "/catalogue/import",
      "menu-extraction": "/catalogue/menu-extraction",
      categories: "/catalogue/categories",
      customers: "/customers",
      channels: "/channels",
      store: "/channels/online-store",
      pos: "/channels/pos",
      locations: "/locations",
      integrations: "/integrations",
      analytics: "/analytics",
      team: "/team",
      access: "/staff/access-requests",
      approvals: "/staff/translation-approvals",
      audit: "/staff/audit",
      "ai-agents": "/settings/ai-agents",
      settings: "/settings",
    };
    for (const [id, suffix] of Object.entries(phase1)) {
      expect(staffNavHref(tenantId, id), id).toBe(`/tenants/${tenantId}${suffix}`);
      expect(staffNavItemById(id)?.availability, id).toBe("ready");
    }
  });

  it("lists no id twice within a More group", () => {
    for (const group of STAFF_MORE_NAV_GROUPS) {
      const ids = group.items.map((item) => item.id);
      expect(new Set(ids).size, group.label).toBe(ids.length);
    }
  });

  it("never shows two More destinations with the same label in either locale", () => {
    for (const locale of ["en", "ar"] as const) {
      const labels = STAFF_MORE_NAV_GROUPS.flatMap((group) =>
        group.items.map((item) => staffNavLabel(locale, item.id, item.label)),
      );
      expect(new Set(labels).size, locale).toBe(labels.length);
    }
  });

  it("has English and Arabic labels for every new nav label and group", () => {
    const labels = [
      ...STAFF_MORE_NAV_GROUPS.flatMap((group) => [
        group.label ?? "",
        ...group.items.map((item) => item.label),
      ]),
      ...STAFF_NAV_GROUPS.flatMap((group) => flattenStaffNavItems(group.items).map((item) => item.label)),
    ].filter(Boolean);
    for (const label of labels) {
      const ar = staffNavLabel("ar", "", label);
      expect(ar, label).not.toBe(label);
      expect(Object.values(STAFF_UI_COPY.ar)).toContain(ar);
    }
  });
});
