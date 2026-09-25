import React from "react";

export function Avatar({ name = "", src, size = "md", tone = "neutral", ...rest }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span className="qos-avatar" data-size={size} data-tone={tone} title={name} {...rest}>
      {src ? <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
    </span>
  );
}
