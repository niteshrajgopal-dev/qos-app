import * as React from "react";

export interface SegmentedControlProps {
  options?: Array<string | { value: string; label: string; icon?: string; disabled?: boolean }>;
  value?: string;
  onChange?: (value: string) => void;
  size?: "md" | "lg";
}

export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
