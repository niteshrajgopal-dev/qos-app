import React from "react";
import { Icon } from "../primitives/Icon.jsx";

export function Tabs({ tabs = [], value, onChange, ...rest }) {
  return (
    <div className="qos-tabs" role="tablist" {...rest}>
      {tabs.map((t) => {
        const id = typeof t === "string" ? t : t.id;
        const label = typeof t === "string" ? t : t.label;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === value}
            className="qos-tab"
            data-selected={id === value || undefined}
            disabled={typeof t === "object" && t.disabled}
            onClick={() => onChange && onChange(id)}
          >
            {typeof t === "object" && t.icon ? <Icon name={t.icon} size={14} /> : null}
            {label}
            {typeof t === "object" && t.count != null ? <span className="qos-tab-count">{t.count}</span> : null}
            {typeof t === "object" && t.tone ? <span className="qos-dot" style={{ background: `var(--status-${t.tone}-solid)` }} /> : null}
          </button>
        );
      })}
    </div>
  );
}
