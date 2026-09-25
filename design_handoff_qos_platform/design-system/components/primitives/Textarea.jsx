import React from "react";
import { Field } from "./Input.jsx";

export function Textarea({ label, hint, error, required, id, rows = 4, style, ...rest }) {
  const el = <textarea id={id} rows={rows} className="qos-textarea" aria-invalid={error ? "true" : undefined} {...rest} />;
  if (!label && !hint && !error) return el;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={id} style={style}>{el}</Field>;
}
