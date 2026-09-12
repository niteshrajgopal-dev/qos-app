import * as React from "react";

export interface AlertProps {
  tone?: "info" | "success" | "warning" | "error" | "neutral" | "intelligence";
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: string;
  actions?: React.ReactNode;
  onDismiss?: () => void;
}

export declare function Alert(props: AlertProps): JSX.Element;
