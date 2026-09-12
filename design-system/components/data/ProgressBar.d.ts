import * as React from "react";

export interface ProgressBarProps {
  value?: number;
  tone?: "brand" | "intelligence";
  indeterminate?: boolean;
  label?: string;
}

export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
