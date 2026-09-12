import * as React from "react";

export interface IconButtonProps {
  icon: string;
  /** Required — becomes aria-label and title. */
  label: string;
  variant?: "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export declare function IconButton(props: IconButtonProps): JSX.Element;
