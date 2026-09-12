import React from "react";
import { Icon } from "./Icon.jsx";

export function Checkbox({ label, description, checked, indeterminate = false, disabled = false, invalid = false, onChange, ...rest }) {
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
