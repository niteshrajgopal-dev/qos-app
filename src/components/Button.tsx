import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon } from "@/components/Icon";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "intelligence";

export type ButtonProps = {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: string;
  iconTrailing?: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
};

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
  onClick,
}: ButtonProps) {
  return (
    <button
      type={type}
      className="qos-btn"
      data-variant={variant}
      data-size={size === "md" ? undefined : size}
      data-full={fullWidth || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {iconTrailing ? <Icon name={iconTrailing} size={16} /> : null}
    </button>
  );
}
