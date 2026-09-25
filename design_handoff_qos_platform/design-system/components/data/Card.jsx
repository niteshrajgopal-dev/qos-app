import React from "react";

export function Card({ children, padding = "md", tone = "default", interactive = false, header, subtitle, actions, style, ...rest }) {
  const hasHeader = header || actions;
  return (
    <div
      className="qos-card"
      data-padding={hasHeader ? "none" : padding}
      data-tone={tone}
      data-interactive={interactive || undefined}
      style={style}
      {...rest}
    >
      {hasHeader ? (
        <div className="qos-card-head">
          <div>
            {header ? <div className="qos-card-title">{header}</div> : null}
            {subtitle ? <div className="qos-card-sub">{subtitle}</div> : null}
          </div>
          {actions ? <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>{actions}</div> : null}
        </div>
      ) : null}
      {hasHeader ? <div style={{ padding: padding === "none" ? 0 : padding === "sm" ? "var(--card-padding-compact)" : "var(--card-padding)" }}>{children}</div> : children}
    </div>
  );
}
