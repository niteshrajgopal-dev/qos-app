import React from "react";
import { Icon } from "../primitives/Icon.jsx";

/* Anchored dropdown. items: {id,label,icon,tone,separator,label-only} */
export function Menu({ items = [], onSelect, align = "right", style, ...rest }) {
  return (
    <div className="qos-menu" style={{ top: 40, [align]: 0, ...style }} role="menu" {...rest}>
      {items.map((it, i) => {
        if (it.separator) return <div className="qos-menu-sep" key={`sep${i}`} />;
        if (it.header) return <div className="qos-menu-label" key={`h${i}`}>{it.header}</div>;
        return (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className="qos-menu-item"
            data-selected={it.selected || undefined}
            style={it.tone === "danger" ? { color: "var(--status-error-fg)" } : undefined}
            onClick={() => onSelect && onSelect(it.id)}
          >
            {it.icon ? <Icon name={it.icon} size={15} style={{ color: it.tone === "danger" ? "inherit" : "var(--text-tertiary)" }} /> : null}
            <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
            {it.shortcut ? <span className="qos-kbd">{it.shortcut}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
