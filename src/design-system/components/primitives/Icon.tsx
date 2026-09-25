"use client";

export type IconProps = {

  /** Lucide icon name, e.g. "search", "alert-triangle". */
  name: string;
  /** px. 14 for dense UI, 16 default, 18–20 for headers. */
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons (then aria-hidden). */
  label?: string;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";

const BASE = "https://unpkg.com/lucide-static@0.469.0/icons/";

/* QOS iconography: Lucide outline set (closest CDN match to the brand guide's icon language —
   2px stroke, rounded caps, 24px optical grid). Rendered as a CSS mask so the glyph always
   inherits currentColor. */
export function Icon({ name, size = 16, strokeWidth, label, style, className, ...rest }: IconProps) {
  const url = `url("${BASE}${name}.svg")`;
  return (
    <span
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: "none",
        background: "currentColor",
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        ...style,
      }}
      data-icon={name}
      {...(strokeWidth != null ? { "data-stroke": strokeWidth } : {})}
      {...rest}
    />
  );
}
