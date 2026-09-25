import React from "react";

export function PageHeader({ title, subtitle, breadcrumbs, badge, actions, meta, tabs, ...rest }) {
  return (
    <div {...rest}>
      {breadcrumbs ? <div style={{ marginBottom: "var(--space-3)" }}>{breadcrumbs}</div> : null}
      <div className="qos-pagehead">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <h1 className="qos-pagetitle">{title}</h1>
            {badge}
          </div>
          {subtitle ? <p className="qos-pagesub">{subtitle}</p> : null}
          {meta ? <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginTop: "var(--space-3)", fontSize: "var(--text-meta-size)", color: "var(--text-secondary)" }}>{meta}</div> : null}
        </div>
        {actions ? <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>{actions}</div> : null}
      </div>
      {tabs ? <div style={{ marginTop: "var(--space-5)" }}>{tabs}</div> : null}
    </div>
  );
}
