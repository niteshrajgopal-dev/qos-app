"use client";

export type IconButtonProps = {

  icon: string;
  /** Required — becomes aria-label and title. */
  label: string;
  variant?: "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "./Icon";

export function IconButton({ icon, label, variant = "ghost", size = "md", selected = false, disabled = false, ...rest }: IconButtonProps) {
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
