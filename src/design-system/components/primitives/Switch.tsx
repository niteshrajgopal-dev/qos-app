"use client";

export type SwitchProps = {

  label?: React.ReactNode;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";

export function Switch({ label, description, checked, disabled = false, onChange, ...rest }: SwitchProps) {
  return (
    <label className="qos-choice" data-disabled={disabled || undefined} style={{ position: "relative", alignItems: "center" }}>
      <input type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={onChange} {...rest} />
      <span className="qos-switch" data-state={checked ? "checked" : "unchecked"} aria-hidden="true" />
      {label ? (
        <span>
          {label}
          {description ? <span style={{ display: "block", color: "var(--text-secondary)", fontSize: "var(--text-meta-size)", lineHeight: "var(--text-meta-lh)" }}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
