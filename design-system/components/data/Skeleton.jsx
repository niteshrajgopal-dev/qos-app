import React from "react";

export function Skeleton({ width = "100%", height = 12, radius = "var(--radius-sm)", style, ...rest }) {
  return <span className="qos-skel" style={{ display: "block", width, height, borderRadius: radius, ...style }} {...rest} />;
}

export function SkeletonText({ lines = 3, gap = 8, ...rest }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }} {...rest}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={10} />
      ))}
    </div>
  );
}
