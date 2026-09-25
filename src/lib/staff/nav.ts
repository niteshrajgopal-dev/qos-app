export type StaffNavAvailability = "ready" | "soon";

export type StaffNavItem = {
  id: string;
  label: string;
  icon?: string;
  availability: StaffNavAvailability;
  children?: StaffNavItem[];
};

export type StaffNavGroup = {
  label?: string;
  items: StaffNavItem[];
};

export const STAFF_NAV_GROUPS: StaffNavGroup[] = [
  {
    items: [
      { id: "home", label: "Home", icon: "layout-dashboard", availability: "ready" },
      { id: "orders", label: "Orders", icon: "receipt", availability: "ready" },
    ],
  },
  {
    label: "Commerce",
    items: [
      {
        id: "catalogue",
        label: "Catalogue",
        icon: "package",
        availability: "ready",
        children: [
          { id: "catalogue", label: "Products", availability: "ready" },
          { id: "menus", label: "Menus", availability: "ready" },
          { id: "modifiers", label: "Modifier groups", availability: "ready" },
          { id: "import", label: "Import", availability: "ready" },
          { id: "categories", label: "Categories", availability: "ready" },
        ],
      },
      { id: "customers", label: "Customers", icon: "users", availability: "ready" },
      {
        id: "channels",
        label: "Sales Channels",
        icon: "store",
        availability: "ready",
        children: [
          { id: "channels", label: "All channels", availability: "ready" },
          { id: "store", label: "Online Store", availability: "ready" },
          { id: "pos", label: "POS", availability: "ready" },
        ],
      },
      { id: "locations", label: "Locations", icon: "map-pin", availability: "ready" },
    ],
  },
  {
    label: "Platform",
    items: [
      { id: "integrations", label: "Integrations", icon: "plug", availability: "ready" },
      { id: "analytics", label: "Analytics", icon: "bar-chart-3", availability: "ready" },
      {
        id: "team",
        label: "Team",
        icon: "shield-check",
        availability: "ready",
        children: [
          { id: "team", label: "Members", availability: "ready" },
          { id: "access", label: "Access requests", availability: "ready" },
          { id: "audit", label: "Audit", availability: "ready" },
        ],
      },
      { id: "settings", label: "Settings", icon: "settings", availability: "ready" },
    ],
  },
];

const STAFF_NAV_PATHS: Record<string, string> = {
  home: "",
  orders: "/orders",
  catalogue: "/catalogue",
  menus: "/catalogue/menus",
  modifiers: "/catalogue/modifier-groups",
  import: "/catalogue/import",
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
  audit: "/staff/audit",
  settings: "/settings",
};

const PATH_MATCHERS: Array<{ id: string; suffix: string }> = [
  { id: "menus", suffix: "/catalogue/menus" },
  { id: "modifiers", suffix: "/catalogue/modifier-groups" },
  { id: "import", suffix: "/catalogue/import" },
  { id: "categories", suffix: "/catalogue/categories" },
  { id: "catalogue", suffix: "/catalogue" },
  { id: "store", suffix: "/channels/online-store" },
  { id: "pos", suffix: "/channels/pos" },
  { id: "channels", suffix: "/channels" },
  { id: "locations", suffix: "/locations" },
  { id: "audit", suffix: "/staff/audit" },
  { id: "access", suffix: "/staff" },
  { id: "team", suffix: "/team" },
  { id: "orders", suffix: "/orders" },
  { id: "customers", suffix: "/customers" },
  { id: "integrations", suffix: "/integrations" },
  { id: "analytics", suffix: "/analytics" },
  { id: "settings", suffix: "/settings" },
];

export function staffNavItemById(id: string): StaffNavItem | undefined {
  for (const group of STAFF_NAV_GROUPS) {
    for (const item of flattenStaffNavItems(group.items)) {
      if (item.id === id) {
        return item;
      }
    }
  }

  return undefined;
}

export function flattenStaffNavItems(items: StaffNavItem[]): StaffNavItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ? flattenStaffNavItems(item.children) : []),
  ]);
}

export function staffNavHref(tenantId: string, itemId: string): string | null {
  const suffix = STAFF_NAV_PATHS[itemId];
  if (suffix === undefined) {
    return null;
  }

  return `/tenants/${tenantId}${suffix}`;
}

export function activeStaffNavIdFromPath(pathname: string): string {
  const tenantPrefix = pathname.match(/^\/tenants\/[^/]+/)?.[0];
  if (!tenantPrefix) {
    return "home";
  }

  const remainder = pathname.slice(tenantPrefix.length);
  if (!remainder || remainder === "/") {
    return "home";
  }

  const match = PATH_MATCHERS.find(({ suffix }) => remainder.startsWith(suffix));
  return match?.id ?? "home";
}
