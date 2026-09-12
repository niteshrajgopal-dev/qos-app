import React from "react";
import { Icon } from "./Icon.jsx";

export function Badge({ children, tone = "neutral", icon, dot = false, pulse = false, ...rest }) {
  return (
    <span className="qos-badge" data-tone={tone} {...rest}>
      {dot ? <span className="qos-dot" data-pulse={pulse || undefined} /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
