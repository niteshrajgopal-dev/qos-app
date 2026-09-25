import React from "react";
import { Icon } from "../primitives/Icon.jsx";
import { IconButton } from "../primitives/IconButton.jsx";

const TONE_ICON = { info: "info", success: "check-circle-2", warning: "alert-triangle", error: "alert-circle", processing: "loader" };

export function Toast({ tone = "info", title, children, action, onDismiss, ...rest }) {
  return (
    <div className="qos-toast" role="status" {...rest}>
      <span style={{ color: `var(--status-${tone}-fg)`, marginTop: 1 }}><Icon name={TONE_ICON[tone]} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div style={{ fontWeight: "var(--fw-semibold)" }}>{title}</div> : null}
        {children ? <div style={{ color: "var(--text-secondary)", marginTop: 1 }}>{children}</div> : null}
        {action ? <div style={{ marginTop: "var(--space-2)" }}>{action}</div> : null}
      </div>
      {onDismiss ? <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} /> : null}
    </div>
  );
}

export function ToastStack({ children, ...rest }) {
  return (
    <div style={{ position: "fixed", right: 24, bottom: 24, display: "flex", flexDirection: "column", gap: 10, zIndex: 80 }} {...rest}>
      {children}
    </div>
  );
}
