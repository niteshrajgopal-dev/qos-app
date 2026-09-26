"use client";

export type InputProps = {

  label?: string;
  hint?: string;
  /** Error message. Sets aria-invalid and the danger ring. */
  error?: string;
  required?: boolean;
  id?: string;
  /** Leading Lucide icon name. */
  leadingIcon?: string;
  /** Trailing node — unit, counter, or IconButton. */
  trailing?: React.ReactNode;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: React.HTMLInputTypeAttribute;
  style?: React.CSSProperties;
  className?: string;
};

export type SearchInputProps = {

  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
  className?: string;
};

export type FieldProps = {

  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "./Icon";

export function Field({ label, hint, error, required, htmlFor, children, style }: FieldProps) {
  return (
    <div className="qos-field" style={style}>
      {label ? (
        <label className="qos-field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="qos-field-req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="qos-field-error"><Icon name="alert-circle" size={13} />{error}</span>
      ) : hint ? (
        <span className="qos-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, required, id, leadingIcon, trailing, style, ...rest }: InputProps) {
  const input = (
    <input
      id={id}
      className="qos-input"
      aria-invalid={error ? "true" : undefined}
      {...rest}
    />
  );
  const shell = leadingIcon || trailing ? (
    <span className="qos-input-wrap">
      {leadingIcon ? <span className="qos-input-lead"><Icon name={leadingIcon} size={15} /></span> : null}
      {input}
      {trailing ? <span className="qos-input-trail">{trailing}</span> : null}
    </span>
  ) : input;
  if (!label && !hint && !error) return <span style={style}>{shell}</span>;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={id} style={style}>{shell}</Field>;
}

export function SearchInput({ placeholder = "Search", style, ...rest }: SearchInputProps) {
  return <Input leadingIcon="search" placeholder={placeholder} type="search" style={style} {...rest} />;
}
