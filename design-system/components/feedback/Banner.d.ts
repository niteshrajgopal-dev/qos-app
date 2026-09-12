import * as React from "react";

export interface BannerProps {
  tone?: "info" | "success" | "warning" | "error";
  icon?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
}

export declare function Banner(props: BannerProps): JSX.Element;
