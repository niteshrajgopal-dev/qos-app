import * as React from "react";

export interface CheckboxProps {
  label?: React.ReactNode;
  description?: string;
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export declare function Checkbox(props: CheckboxProps): JSX.Element;
