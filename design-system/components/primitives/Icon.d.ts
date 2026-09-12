import * as React from "react";

export interface IconProps {
  /** Lucide icon name, e.g. "search", "alert-triangle". */
  name: string;
  /** px. 14 for dense UI, 16 default, 18–20 for headers. */
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons (then aria-hidden). */
  label?: string;
  style?: React.CSSProperties;
  className?: string;
}

export declare function Icon(props: IconProps): JSX.Element;
