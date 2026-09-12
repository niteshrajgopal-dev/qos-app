import * as React from "react";

export interface SelectProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  options?: Array<string | { value: string; label: string }>;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

export declare function Select(props: SelectProps): JSX.Element;
