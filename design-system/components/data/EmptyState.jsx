import React from "react";
import { Icon } from "../primitives/Icon.jsx";

export function EmptyState({ icon = "inbox", title, body, tone = "default", actions, ...rest }) {
  return (
    <div className="qos-empty" data-tone={tone} {...rest}>
      <span className="qos-empty-art"><Icon name={icon} size={28} /></span>
      {title ? <div className="qos-empty-title">{title}</div> : null}
      {body ? <p className="qos-empty-body">{body}</p> : null}
      {actions ? <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 4 }}>{actions}</div> : null}
    </div>
  );
}
