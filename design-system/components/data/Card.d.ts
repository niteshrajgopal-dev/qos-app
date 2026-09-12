import * as React from "react";

export interface CardProps {
  children?: React.ReactNode;
  padding?: "none" | "sm" | "md";
  tone?: "default" | "intelligence";
  interactive?: boolean;
  header?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function Card(props: CardProps): JSX.Element;
