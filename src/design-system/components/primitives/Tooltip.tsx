"use client";

export type TooltipProps = {

  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";

export function Tooltip({ content, side = "top", children, ...rest }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <span
      className="qos-tooltip-host"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...rest}
    >
      {children}
      {open ? <span className="qos-tooltip" data-side={side} role="tooltip">{content}</span> : null}
    </span>
  );
}
