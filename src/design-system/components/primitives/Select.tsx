"use client";

export type SelectProps = {

  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  options?: Array<string | { value: string; label: string }>;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Field } from "./Input";

export function Select({ label, hint, error, required, id, options = [], placeholder, style, ...rest }: SelectProps) {
  const el = (
    <select id={id} className="qos-select" aria-invalid={error ? "true" : undefined} {...rest}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => {
        const value = typeof o === "string" ? o : o.value;
        const text = typeof o === "string" ? o : o.label;
        return <option key={value} value={value}>{text}</option>;
      })}
    </select>
  );
  if (!label && !hint && !error) return <span style={style}>{el}</span>;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={id} style={style}>{el}</Field>;
}
