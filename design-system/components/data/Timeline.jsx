import React from "react";
import { Icon } from "../primitives/Icon.jsx";

/* Event timeline — order lifecycle, integration activity, publishing history.
   items: {title, meta, tone, icon, detail} */
export function Timeline({ items = [], ...rest }) {
  return (
    <div className="qos-timeline" {...rest}>
      {items.map((it, i) => (
        <div className="qos-tl-item" key={it.id || i}>
          <span className="qos-tl-dot" data-tone={it.tone || "neutral"}><Icon name={it.icon || "circle"} size={12} /></span>
          <div>
            <div className="qos-tl-title">{it.title}</div>
            {it.meta ? <div className="qos-tl-meta">{it.meta}</div> : null}
            {it.detail ? <div style={{ marginTop: 6 }}>{it.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
