import type { MouseEventHandler } from "react";

import { Icon } from "@/components/Icon";

type IconButtonProps = {
  icon: string;
  label: string;
  variant?: "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  selected = false,
  disabled = false,
  onClick,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className="qos-iconbtn"
      data-variant={variant === "ghost" ? undefined : variant}
      data-size={size === "md" ? undefined : size}
      data-selected={selected || undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
