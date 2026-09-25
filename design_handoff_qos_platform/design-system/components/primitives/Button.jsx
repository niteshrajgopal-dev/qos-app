import React from "react";
import { Icon } from "./Icon.jsx";

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconTrailing,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = "button",
  ...rest
}) {
  const glyph = size === "lg" ? 18 : size === "sm" ? 13 : 15;
  return (
    <button
      type={type}
      className="qos-btn"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-full={fullWidth || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {icon ? <Icon name={icon} size={glyph} /> : null}
      {children}
      {iconTrailing ? <Icon name={iconTrailing} size={glyph} /> : null}
    </button>
  );
}
