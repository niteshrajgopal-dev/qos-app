"use client";

import { useMemo, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/Icon";
import { OverlaySurface } from "@/components/overlay-surface";
import {
  cycleOverlayIndex,
  filterCommandGroups,
  type CommandPaletteGroup,
  type CommandPaletteItem,
} from "@/lib/staff/overlay";

export type CommandPaletteProps = {
  open?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  groups?: CommandPaletteGroup[];
  onSelect?: (item: CommandPaletteItem) => void;
  onClose?: () => void;
  placeholder?: string;
};

export function CommandPalette({
  open = false,
  query = "",
  onQueryChange,
  groups = [],
  onSelect,
  onClose,
  placeholder = "Search",
}: CommandPaletteProps) {
  const visibleGroups = useMemo(
    () => filterCommandGroups(groups, query),
    [groups, query],
  );
  const flatItems = visibleGroups.flatMap((group) => group.items);
  const [activeIndex, setActiveIndex] = useState(0);
  const safeIndex = flatItems.length === 0 ? 0 : activeIndex % flatItems.length;

  if (!open) {
    return null;
  }

  function move(direction: 1 | -1) {
    setActiveIndex((current) =>
      cycleOverlayIndex(current, flatItems.length, direction),
    );
  }

  function selectActive() {
    const item = flatItems[safeIndex];
    if (item) {
      onSelect?.(item);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectActive();
    }
  }

  return (
    <OverlaySurface className="qos-scrim" onClose={onClose}>
      <div className="qos-cmd" role="dialog" aria-modal="true" aria-labelledby="qos-cmd-input">
        <div className="qos-cmd-input">
          <Icon name="search" size={16} />
          <input
            id="qos-cmd-input"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
            onChange={(event) => onQueryChange?.(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="qos-kbd">esc</kbd>
        </div>
        <div className="qos-cmd-list" role="listbox">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="qos-cmd-group">{group.label}</div>
              {group.items.map((item) => {
                const index = flatItems.indexOf(item);
                return (
                  <button
                    key={`${group.label}-${item.id}`}
                    type="button"
                    role="option"
                    className="qos-cmd-item"
                    data-active={index === safeIndex || undefined}
                    data-intelligence={item.intelligence || undefined}
                    aria-selected={index === safeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onSelect?.(item)}
                  >
                    {item.icon ? <Icon name={item.icon} size={16} /> : null}
                    <span>{item.label}</span>
                    {item.kind || item.meta ? (
                      <span className="qos-cmd-kind">{item.kind ?? item.meta}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </OverlaySurface>
  );
}
