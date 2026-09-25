"use client";

export type SegmentedControlProps = {

  options?: Array<string | { value: string; label: string; icon?: string; disabled?: boolean }>;
  value?: string;
  onChange?: (value: string) => void;
  size?: "md" | "lg";
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "./Icon";

export function SegmentedControl({ options = [], value, onChange, size = "md", ...rest }: SegmentedControlProps) {
  return (
    <div className="qos-segmented" role="tablist" {...rest}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const icon = typeof o === "string" ? null : o.icon;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={v === value}
            className="qos-segmented-item"
            data-selected={v === value || undefined}
            disabled={typeof o === "object" && o.disabled}
            onClick={() => onChange && onChange(v)}
            style={size === "lg" ? { height: 34, padding: "0 14px" } : undefined}
          >
            {icon ? <Icon name={icon} size={14} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
