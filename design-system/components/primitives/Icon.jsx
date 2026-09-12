import React from "react";

const BASE = "https://unpkg.com/lucide-static@0.469.0/icons/";

/* QOS iconography: Lucide outline set (closest CDN match to the brand guide's icon language —
   2px stroke, rounded caps, 24px optical grid). Rendered as a CSS mask so the glyph always
   inherits currentColor. */
export function Icon({ name, size = 16, strokeWidth, label, style, className, ...rest }) {
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
      data-stroke={strokeWidth}
      {...rest}
    />
  );
}
