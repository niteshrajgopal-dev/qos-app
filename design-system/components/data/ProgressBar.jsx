import React from "react";

export function ProgressBar({ value = 0, tone = "brand", indeterminate = false, label, ...rest }) {
  return (
    <div {...rest}>
      {label ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-meta-size)", color: "var(--text-secondary)", marginBottom: 6 }}>
          <span>{label}</span>
          {!indeterminate ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(value)}%</span> : null}
        </div>
      ) : null}
      <div className="qos-progress" data-tone={tone} data-indeterminate={indeterminate || undefined} role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <div className="qos-progress-fill" style={{ width: indeterminate ? undefined : `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
