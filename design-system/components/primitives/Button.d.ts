import * as React from "react";

export interface ButtonProps {
  children?: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "intelligence";
  size?: "sm" | "md" | "lg";
  /** Leading Lucide icon name. */
  icon?: string;
  /** Trailing Lucide icon name. */
  iconTrailing?: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export declare function Button(props: ButtonProps): JSX.Element;
