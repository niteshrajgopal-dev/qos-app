/* Inventory screen tabs, shared by the server page (reads `?tab=`) and the
   client screen. An unknown value opens the items tab. */

export const INVENTORY_TABS = ["items", "units", "categories", "suppliers", "warehouses"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export function inventoryTabFrom(value: unknown): InventoryTab {
  return INVENTORY_TABS.find((tab) => tab === value) ?? "items";
}
