import { describe, expect, it } from "vitest";

import { STAFF_NAV_GROUPS } from "@/lib/staff/nav";
import {
  buildStaffCommandGroups,
  cycleOverlayIndex,
  filterCommandGroups,
  isCommandPaletteHotkey,
  isOverlayDismissKey,
  overlayDrawerInlineSide,
} from "@/lib/staff/overlay";

describe("overlay keyboard contract", () => {
  it("dismisses overlays on Escape only", () => {
    expect(isOverlayDismissKey("Escape")).toBe(true);
    expect(isOverlayDismissKey("Esc")).toBe(true);
    expect(isOverlayDismissKey("Enter")).toBe(false);
    expect(isOverlayDismissKey("Tab")).toBe(false);
  });

  it("opens the command palette with Ctrl/Cmd+K", () => {
    expect(
      isCommandPaletteHotkey({ key: "k", metaKey: true, ctrlKey: false }),
    ).toBe(true);
    expect(
      isCommandPaletteHotkey({ key: "K", metaKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(
      isCommandPaletteHotkey({ key: "k", metaKey: false, ctrlKey: false }),
    ).toBe(false);
    expect(
      isCommandPaletteHotkey({ key: "p", metaKey: true, ctrlKey: false }),
    ).toBe(false);
  });

  it("wraps keyboard selection inside an overlay list", () => {
    expect(cycleOverlayIndex(0, 3, 1)).toBe(1);
    expect(cycleOverlayIndex(2, 3, 1)).toBe(0);
    expect(cycleOverlayIndex(0, 3, -1)).toBe(2);
    expect(cycleOverlayIndex(0, 0, 1)).toBe(0);
  });
});

describe("overlay RTL contract", () => {
  it("docks drawers on the inline-end edge so Arabic opens on the left", () => {
    expect(overlayDrawerInlineSide("ltr")).toBe("end");
    expect(overlayDrawerInlineSide("rtl")).toBe("end");
  });
});

describe("command palette filtering", () => {
  it("filters by label or meta and drops empty groups", () => {
    const groups = [
      {
        label: "Commerce",
        items: [
          { id: "menus", label: "Menus", meta: "Go" },
          { id: "products", label: "Products", meta: "Go" },
        ],
      },
      {
        label: "Platform",
        items: [{ id: "settings", label: "Settings", meta: "Go" }],
      },
    ];

    expect(filterCommandGroups(groups, "men")).toEqual([
      {
        label: "Commerce",
        items: [{ id: "menus", label: "Menus", meta: "Go" }],
      },
    ]);
    expect(filterCommandGroups(groups, "  ")).toEqual(groups);
  });

  it("builds ready staff destinations for the current locale", () => {
    const groups = buildStaffCommandGroups(STAFF_NAV_GROUPS, "ar");
    const items = groups.flatMap((group) => group.items);

    expect(items.some((item) => item.id === "categories")).toBe(true);
    expect(items.find((item) => item.id === "menus")?.label).toBe("القوائم");
    expect(items.every((item) => item.kind === "انتقال")).toBe(true);
    expect(items.some((item) => item.id === "soon")).toBe(false);
  });
});
