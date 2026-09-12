import * as React from "react";

export interface RadioProps {
  label?: React.ReactNode;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  name?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export declare function Radio(props: RadioProps): JSX.Element;
