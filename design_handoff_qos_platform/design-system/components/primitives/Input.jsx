import React from "react";
import { Icon } from "./Icon.jsx";

export function Field({ label, hint, error, required, htmlFor, children, style }) {
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

export function Input({ label, hint, error, required, id, leadingIcon, trailing, style, ...rest }) {
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

export function SearchInput({ placeholder = "Search", style, ...rest }) {
  return <Input leadingIcon="search" placeholder={placeholder} type="search" style={style} {...rest} />;
}
