import React from "react";
import { Icon } from "./Icon.jsx";

export function IconButton({ icon, label, variant = "ghost", size = "md", selected = false, disabled = false, ...rest }) {
  return (
    <button
      type="button"
      className="qos-iconbtn"
      aria-label={label}
      title={label}
      data-variant={variant}
      data-size={size}
      data-selected={selected || undefined}
      disabled={disabled}
      {...rest}
    >
      <Icon name={icon} size={size === "lg" ? 18 : size === "sm" ? 14 : 16} />
    </button>
  );
}
