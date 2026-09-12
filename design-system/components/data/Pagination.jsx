import React from "react";
import { Icon } from "../primitives/Icon.jsx";

export function Pagination({ page = 1, pageCount = 1, pageSize, total, onPageChange, ...rest }) {
  const pages = [];
  for (let p = 1; p <= pageCount; p += 1) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  return (
    <div className="qos-pagination" {...rest}>
      <span>
        {total != null && pageSize != null
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()}`
          : `Page ${page} of ${pageCount}`}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button type="button" className="qos-page-btn" disabled={page <= 1} onClick={() => onPageChange && onPageChange(page - 1)} aria-label="Previous page"><Icon name="chevron-left" size={14} /></button>
        {pages.map((p, i) => p === "…"
          ? <span key={`gap${i}`} style={{ padding: "0 4px", color: "var(--text-tertiary)" }}>…</span>
          : <button key={p} type="button" className="qos-page-btn" data-selected={p === page || undefined} onClick={() => onPageChange && onPageChange(p)}>{p}</button>)}
        <button type="button" className="qos-page-btn" disabled={page >= pageCount} onClick={() => onPageChange && onPageChange(page + 1)} aria-label="Next page"><Icon name="chevron-right" size={14} /></button>
      </div>
    </div>
  );
}
