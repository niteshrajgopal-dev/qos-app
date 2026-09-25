"use client";

export type ChipProps = {

  children?: React.ReactNode;
  icon?: string;
  selected?: boolean;
  disabled?: boolean;
  count?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "./Icon";

export function Chip({ children, icon, selected = false, disabled = false, count, onClick, ...rest }: ChipProps) {
  return (
    <button type="button" className="qos-chip" data-selected={selected || undefined} disabled={disabled} onClick={onClick} {...rest}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
      {count != null ? <span style={{ color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{count}</span> : null}
    </button>
  );
}
