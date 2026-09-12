import React from "react";
import { Icon } from "../primitives/Icon.jsx";
import { IconButton } from "../primitives/IconButton.jsx";

const TONE_ICON = { info: "info", success: "check-circle-2", warning: "alert-triangle", error: "alert-circle", neutral: "info", intelligence: "sparkles" };

export function Alert({ tone = "info", title, children, icon, actions, onDismiss, ...rest }) {
  return (
    <div className="qos-alert" data-tone={tone} role={tone === "error" ? "alert" : "status"} {...rest}>
      <span className="qos-alert-icon" style={{ color: `var(--status-${tone === "intelligence" ? "info" : tone}-fg, var(--text-intelligence))` }}>
        <Icon name={icon || TONE_ICON[tone]} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div className="qos-alert-title">{title}</div> : null}
        {children ? <div className="qos-alert-body">{children}</div> : null}
        {actions ? <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>{actions}</div> : null}
      </div>
      {onDismiss ? <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} /> : null}
    </div>
  );
}
