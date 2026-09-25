"use client";

export type BadgeProps = {

  children?: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "error" | "info" | "processing" | "intelligence";
  icon?: string;
  dot?: boolean;
  pulse?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "./Icon";

export function Badge({ children, tone = "neutral", icon, dot = false, pulse = false, ...rest }: BadgeProps) {
  return (
    <span className="qos-badge" data-tone={tone} {...rest}>
      {dot ? <span className="qos-dot" data-pulse={pulse || undefined} /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
