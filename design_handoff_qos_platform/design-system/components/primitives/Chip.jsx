import React from "react";
import { Icon } from "./Icon.jsx";

export function Chip({ children, icon, selected = false, disabled = false, count, onClick, ...rest }) {
  return (
    <button type="button" className="qos-chip" data-selected={selected || undefined} disabled={disabled} onClick={onClick} {...rest}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
      {count != null ? <span style={{ color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{count}</span> : null}
    </button>
  );
}
