import * as React from "react";

export interface SwitchProps {
  label?: React.ReactNode;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export declare function Switch(props: SwitchProps): JSX.Element;
