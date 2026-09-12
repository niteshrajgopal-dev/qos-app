import React from "react";
import { Icon } from "../primitives/Icon.jsx";

export function TenantSwitcher({ tenants = [], value, onChange, label = "Business", ...rest }) {
  const [open, setOpen] = React.useState(false);
  const current = tenants.find((t) => t.id === value) || tenants[0] || {};
  const initials = (current.name || "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div style={{ position: "relative" }} {...rest}>
      <button type="button" className="qos-tenant" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="qos-tenant-mark">{initials}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
          <span style={{ fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: "var(--fw-semibold)" }}>{label}</span>
          <span>{current.name}</span>
        </span>
        <Icon name="chevrons-up-down" size={14} style={{ color: "var(--text-tertiary)" }} />
      </button>
      {open ? (
        <div className="qos-menu" role="listbox" style={{ top: 40, left: 0, minWidth: 280 }}>
          <div className="qos-menu-label">Switch business</div>
          {tenants.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.id === current.id}
              className="qos-menu-item"
              data-selected={t.id === current.id || undefined}
              onClick={() => { setOpen(false); onChange && onChange(t.id); }}
            >
              <span className="qos-tenant-mark" style={t.id === current.id ? undefined : { background: "var(--surface-sunken)", color: "var(--text-secondary)" }}>
                {(t.name || "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {t.name}
                {t.meta ? <span style={{ display: "block", fontSize: "var(--text-meta-size)", color: "var(--text-secondary)" }}>{t.meta}</span> : null}
              </span>
              {t.id === current.id ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
          <div className="qos-menu-sep" />
          <button type="button" className="qos-menu-item"><Icon name="building-2" size={15} />All businesses</button>
        </div>
      ) : null}
    </div>
  );
}
