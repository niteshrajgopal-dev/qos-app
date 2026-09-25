"use client";

export type SkeletonProps = {

  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: React.CSSProperties;
  className?: string;
};

export type SkeletonTextProps = {

  lines?: number;
  gap?: number;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";

export function Skeleton({ width = "100%", height = 12, radius = "var(--radius-sm)", style, ...rest }: SkeletonProps) {
  return <span className="qos-skel" style={{ display: "block", width, height, borderRadius: radius, ...style }} {...rest} />;
}

export function SkeletonText({ lines = 3, gap = 8, ...rest }: SkeletonTextProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }} {...rest}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={10} />
      ))}
    </div>
  );
}
