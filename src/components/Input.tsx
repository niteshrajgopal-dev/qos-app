import type { InputHTMLAttributes } from "react";

import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";

type InputProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  leadingIcon?: string;
  trailing?: React.ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export function Input({
  label,
  hint,
  error,
  required,
  id,
  leadingIcon,
  trailing,
  ...inputProps
}: InputProps) {
  const invalid = Boolean(error);

  const control = (
    <span className={leadingIcon || trailing ? "qos-input-wrap" : undefined}>
      {leadingIcon ? (
        <span className="qos-input-lead">
          <Icon name={leadingIcon} size={16} />
        </span>
      ) : null}
      <input
        id={id}
        className="qos-input"
        aria-invalid={invalid || undefined}
        required={required}
        {...inputProps}
      />
      {trailing ? <span className="qos-input-trail">{trailing}</span> : null}
    </span>
  );

  if (!label && !hint && !error) {
    return control;
  }

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={id}>
      {control}
    </Field>
  );
}
