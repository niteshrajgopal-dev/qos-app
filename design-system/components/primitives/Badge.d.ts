import * as React from "react";

export interface BadgeProps {
  children?: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "error" | "info" | "processing" | "intelligence";
  icon?: string;
  dot?: boolean;
  pulse?: boolean;
}

export declare function Badge(props: BadgeProps): JSX.Element;
