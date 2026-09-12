import * as React from "react";

export interface ChipProps {
  children?: React.ReactNode;
  icon?: string;
  selected?: boolean;
  disabled?: boolean;
  count?: number;
  onClick?: () => void;
}

export declare function Chip(props: ChipProps): JSX.Element;
