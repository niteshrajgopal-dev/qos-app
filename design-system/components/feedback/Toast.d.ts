import * as React from "react";

export interface ToastProps {
  tone?: "info" | "success" | "warning" | "error" | "processing";
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
}

export declare function Toast(props: ToastProps): JSX.Element;

export interface ToastStackProps {
  children?: React.ReactNode;
}

export declare function ToastStack(props: ToastStackProps): JSX.Element;
