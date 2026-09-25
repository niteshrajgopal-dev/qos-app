"use client";

export type TextareaProps = {

  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  rows?: number;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Field } from "./Input";

export function Textarea({ label, hint, error, required, id, rows = 4, style, ...rest }: TextareaProps) {
  const el = <textarea id={id} rows={rows} className="qos-textarea" aria-invalid={error ? "true" : undefined} {...rest} />;
  if (!label && !hint && !error) return el;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={id} style={style}>{el}</Field>;
}
