import * as React from "react";

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: string;
  deltaDirection?: "up" | "down" | "flat";
  caption?: string;
  icon?: string;
  href?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

export declare function KpiCard(props: KpiCardProps): JSX.Element;
