"use client";

export type BannerProps = {

  tone?: "info" | "success" | "warning" | "error";
  icon?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";

/* Full-width, shell-level message: environment notice, unsaved changes, degraded integration. */
export function Banner({ tone = "info", icon, children, actions, onDismiss, ...rest }: BannerProps) {
  return (
    <div className="qos-banner" data-tone={tone} {...rest}>
      {icon ? <Icon name={icon} size={15} style={{ color: `var(--status-${tone}-fg)` }} /> : null}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {actions}
      {onDismiss ? <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} /> : null}
    </div>
  );
}
