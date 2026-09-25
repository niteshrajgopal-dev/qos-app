import React from "react";
import { Icon } from "../primitives/Icon.jsx";

/* Global search / command surface. Intelligent results are marked with the intelligence
   accent; system records are not. */
export function CommandPalette({ open = true, query = "", onQueryChange, groups = [], onSelect, onClose, placeholder = "Search businesses, orders, products, locations…", ...rest }) {
  const [active, setActive] = React.useState(0);
  if (!open) return null;
  const flat = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
  return (
    <div className="qos-scrim" style={{ alignItems: "flex-start", paddingTop: "12vh" }} onClick={onClose}>
      <div className="qos-cmd" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} {...rest}>
        <div className="qos-cmd-input">
          <Icon name="search" size={17} style={{ color: "var(--text-tertiary)" }} />
          <input
            autoFocus
            value={query}
            placeholder={placeholder}
            onChange={(e) => onQueryChange && onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, flat.length - 1));
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              if (e.key === "Enter" && flat[active] && onSelect) onSelect(flat[active]);
              if (e.key === "Escape" && onClose) onClose();
            }}
          />
          <span className="qos-kbd">Esc</span>
        </div>
        <div className="qos-cmd-list">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="qos-menu-label">{g.label}</div>
              {g.items.map((it) => {
                const idx = flat.findIndex((f) => f.id === it.id);
                return (
                  <div
                    key={it.id}
                    className="qos-cmd-item"
                    data-active={idx === active || undefined}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => onSelect && onSelect(it)}
                  >
                    <span style={it.intelligence ? { color: "var(--intelligence-accent)" } : { color: "var(--text-tertiary)" }}>
                      <Icon name={it.icon || (it.intelligence ? "sparkles" : "file")} size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {it.label}
                      {it.meta ? <span style={{ display: "block", fontSize: "var(--text-meta-size)", color: "var(--text-secondary)" }}>{it.meta}</span> : null}
                    </span>
                    <span className="qos-cmd-kind">{it.kind}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
