"use client";

export type LogoProps = {

  variant?: "light" | "navy" | "icon";
  /** Rendered height in px. Minimum 24px per brand guide (section 01). */
  height?: number;
  /** Path prefix to the design-system assets/ folder. */
  assetBase?: string;
  tagline?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";

/* The approved QOS wordmark. Never redraw or recolour it — these are the supplied raster
   assets. `variant` picks the artwork cut for the background it sits on. */
const SRC = {
  light: "logo.png",        // navy letterforms — for Cloud/white surfaces
  navy: "logo-on-navy.png", // supplied dark-background cut
  icon: "app-icon.png",     // supplied app icon (512×512 artwork)
};

/* The supplied dark-background artwork is a raster cut with its own near-black ground
   (rgb(5,9,17)), so the navy variant is always presented on a matching plaque — the edge
   is then intentional instead of reading as a crop artifact over imagery. */
export function Logo({ variant = "light", height = 24, assetBase = "/brand/", tagline = false, ...rest }: LogoProps) {
  const img = (
    <img
      src={`${assetBase}${SRC[variant] || SRC.light}`}
      alt="QOS"
      style={{ height, width: "auto", display: "block" }}
    />
  );
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, lineHeight: 0 }} {...rest}>
      {variant === "navy" ? (
        <span style={{ display: "inline-flex", padding: `${Math.round(height * 0.28)}px ${Math.round(height * 0.42)}px`, borderRadius: "var(--radius-lg)", background: "rgb(5,9,17)" }}>{img}</span>
      ) : img}
      {tagline ? (
        <span style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--text-secondary)", lineHeight: 1.2 }}>
          Ideas today. Impact tomorrow.
        </span>
      ) : null}
    </span>
  );
}
