"use client";

export type CheckboxProps = {

  label?: React.ReactNode;
  description?: string;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "./Icon";

export function Checkbox({ label, description, checked, indeterminate = false, disabled = false, invalid = false, onChange, ...rest }: CheckboxProps) {
  const state = indeterminate ? "indeterminate" : checked ? "checked" : "unchecked";
  return (
    <label className="qos-choice" data-disabled={disabled || undefined} data-invalid={invalid || undefined} style={{ position: "relative" }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange} {...rest} />
      <span className="qos-choice-box" data-state={state} aria-hidden="true">
        {state === "checked" ? <Icon name="check" size={12} /> : null}
        {state === "indeterminate" ? <Icon name="minus" size={12} /> : null}
      </span>
      {label ? (
        <span>
          {label}
          {description ? <span style={{ display: "block", color: "var(--text-secondary)", fontSize: "var(--text-meta-size)", lineHeight: "var(--text-meta-lh)" }}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
