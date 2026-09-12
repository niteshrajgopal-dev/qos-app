import * as React from "react";

export interface AvatarProps {
  name?: string;
  src?: string;
  size?: "sm" | "md" | "lg";
  tone?: "neutral" | "brand";
}

export declare function Avatar(props: AvatarProps): JSX.Element;
