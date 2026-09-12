import React from "react";

export function Radio({ label, description, checked, disabled = false, name, onChange, ...rest }) {
  return (
    <label className="qos-choice" data-disabled={disabled || undefined} style={{ position: "relative" }}>
      <input type="radio" name={name} checked={!!checked} disabled={disabled} onChange={onChange} {...rest} />
      <span className="qos-choice-box" data-shape="radio" data-state={checked ? "checked" : "unchecked"} aria-hidden="true" style={checked ? { borderColor: "var(--action-primary)" } : undefined} />
      {label ? (
        <span>
          {label}
          {description ? <span style={{ display: "block", color: "var(--text-secondary)", fontSize: "var(--text-meta-size)", lineHeight: "var(--text-meta-lh)" }}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
