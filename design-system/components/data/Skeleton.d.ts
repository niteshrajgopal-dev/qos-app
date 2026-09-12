import * as React from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: React.CSSProperties;
}

export declare function Skeleton(props: SkeletonProps): JSX.Element;

export interface SkeletonTextProps {
  lines?: number;
  gap?: number;
}

export declare function SkeletonText(props: SkeletonTextProps): JSX.Element;
