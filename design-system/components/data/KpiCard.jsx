import React from "react";
import { Icon } from "../primitives/Icon.jsx";

export function KpiCard({ label, value, unit, delta, deltaDirection = "flat", caption, icon, href, onClick, children, ...rest }) {
  return (
    <div className="qos-card" data-padding="md" data-interactive={onClick || href ? "true" : undefined} onClick={onClick} {...rest}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <div style={{ minWidth: 0 }}>
          <div className="qos-kpi-label">{label}</div>
          <div className="qos-kpi-value">
            {value}
            {unit ? <span style={{ fontSize: 16, fontWeight: "var(--fw-medium)", color: "var(--text-secondary)", marginLeft: 3 }}>{unit}</span> : null}
          </div>
        </div>
        {icon ? <span className="qos-kpi-icon"><Icon name={icon} size={16} /></span> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 8, flexWrap: "wrap" }}>
        {delta ? (
          <span className="qos-kpi-delta" data-dir={deltaDirection}>
            <Icon name={deltaDirection === "up" ? "trending-up" : deltaDirection === "down" ? "trending-down" : "minus"} size={13} />
            {delta}
          </span>
        ) : null}
        {caption ? <span style={{ fontSize: "var(--text-meta-size)", color: "var(--text-secondary)" }}>{caption}</span> : null}
      </div>
      {children}
    </div>
  );
}
