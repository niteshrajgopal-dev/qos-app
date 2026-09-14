import {
  flattenStaffNavItems,
  type StaffNavGroup,
  type StaffNavItem,
} from "@/lib/staff/nav";
import { staffNavLabel, staffUiCopy, type StaffLocale } from "@/lib/staff/locale";

export type CommandPaletteItem = {
  id: string;
  label: string;
  meta?: string;
  kind?: string;
  icon?: string;
  intelligence?: boolean;
};

export type CommandPaletteGroup = {
  label: string;
  items: CommandPaletteItem[];
};

/**
 * Overlay keyboard / RTL contract used by Modal, Drawer, and CommandPalette:
 * - Escape dismisses
 * - Ctrl/Cmd+K toggles the palette
 * - Arrow wrapping stays inside the open surface
 * - Drawers dock on the inline-end edge so `dir=rtl` opens them on the left
 */
export function isOverlayDismissKey(key: string): boolean {
  return key === "Escape" || key === "Esc";
}

export function isCommandPaletteHotkey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
}

export function cycleOverlayIndex(
  current: number,
  count: number,
  direction: 1 | -1,
): number {
  if (count <= 0) {
    return 0;
  }

  return (current + direction + count) % count;
}

export function overlayDrawerInlineSide(
  direction: "ltr" | "rtl",
): "end" {
  void direction;
  return "end";
}

export function filterCommandGroups(
  groups: CommandPaletteGroup[],
  query: string,
): CommandPaletteGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = [item.label, item.meta, item.kind, item.id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

function readyLeafItems(items: StaffNavItem[]): StaffNavItem[] {
  return items.flatMap((item) => {
    if (item.availability !== "ready") {
      return [];
    }

    if (item.children && item.children.length > 0) {
      return readyLeafItems(item.children);
    }

    return [item];
  });
}

export function buildStaffCommandGroups(
  navGroups: StaffNavGroup[],
  locale: StaffLocale,
): CommandPaletteGroup[] {
  const go = staffUiCopy(locale, "commandGo");

  return navGroups.flatMap((group) => {
    const items = readyLeafItems(group.items).map((item) => {
      const icon =
        item.icon ??
        flattenStaffNavItems(group.items).find(
          (candidate) => candidate.id === item.id && candidate.icon,
        )?.icon;

      return {
        id: item.id,
        label: staffNavLabel(locale, item.id, item.label),
        kind: go,
        icon,
      };
    });

    if (items.length === 0) {
      return [];
    }

    return [
      {
        label: group.label
          ? staffNavLabel(locale, group.label.toLowerCase(), group.label)
          : staffUiCopy(locale, "workspace"),
        items,
      },
    ];
  });
}
