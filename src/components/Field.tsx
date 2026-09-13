import type { ReactNode } from "react";

type FieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children?: ReactNode;
};

export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
}: FieldProps) {
  return (
    <div className="qos-field">
      {label ? (
        <label className="qos-field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="qos-field-req">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="qos-field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="qos-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}
