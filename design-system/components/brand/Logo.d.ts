import * as React from "react";

export interface LogoProps {
  variant?: "light" | "navy" | "icon";
  /** Rendered height in px. Minimum 24px per brand guide (section 01). */
  height?: number;
  /** Path prefix to the design-system assets/ folder. */
  assetBase?: string;
  tagline?: boolean;
}

export declare function Logo(props: LogoProps): JSX.Element;
