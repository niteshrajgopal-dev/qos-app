import type { ReactNode } from "react";

import { Icon } from "./Icon";

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "processing"
  | "intelligence";

export type BadgeProps = {
  children?: ReactNode;
  tone?: BadgeTone;
  icon?: string;
  dot?: boolean;
  pulse?: boolean;
};

export function Badge({
  children,
  tone = "neutral",
  icon,
  dot = false,
  pulse = false,
}: BadgeProps) {
  return (
    <span className="qos-badge" data-tone={tone}>
      {dot ? <span className="qos-dot" data-pulse={pulse || undefined} /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
