"use client";

export type BreadcrumbsProps = {

  items?: Array<{ id?: string; label: string; href?: string }>;
  onNavigate?: (id?: string) => void;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";
import { Icon } from "../primitives/Icon";

export function Breadcrumbs({ items = [], onNavigate, ...rest }: BreadcrumbsProps) {
  return (
    <nav className="qos-crumbs" aria-label="Breadcrumb" {...rest}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={it.id || it.label}>
            {last
              ? <span className="qos-crumb-current" aria-current="page">{it.label}</span>
              : <a href={it.href || "#"} onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate(it.id); } }}>{it.label}</a>}
            {!last ? <Icon name="chevron-right" size={13} className="qos-crumb-sep" style={{ color: "var(--text-tertiary)" }} /> : null}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
