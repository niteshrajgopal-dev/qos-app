import React from "react";
import { Icon } from "../primitives/Icon.jsx";

/* QOS left navigation. groups: [{label, items:[{id,label,icon,count,children:[…]}]}]
   Theme it dark by wrapping in [data-qos-theme="dark"] for the branded shell. */
export function SideNav({ groups = [], activeId, onNavigate, brand, footer, collapsed = false, ...rest }) {
  const [open, setOpen] = React.useState(() => {
    const init = {};
    groups.forEach((g) => g.items.forEach((i) => { if (i.children && i.children.some((c) => c.id === activeId)) init[i.id] = true; }));
    return init;
  });
  return (
    <nav className="qos-sidenav" style={collapsed ? { width: "var(--layout-nav-width-collapsed)" } : undefined} {...rest}>
      {brand ? <div className="qos-sidenav-brand">{brand}</div> : null}
      <div className="qos-sidenav-scroll">
        {groups.map((g, gi) => (
          <div key={g.label || gi}>
            {g.label && !collapsed ? <div className="qos-nav-group-label">{g.label}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {g.items.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const isOpen = !!open[item.id];
                const selected = activeId === item.id || (hasChildren && !isOpen && item.children.some((c) => c.id === activeId));
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      className="qos-nav-item"
                      data-selected={selected || undefined}
                      title={collapsed ? item.label : undefined}
                      onClick={() => {
                        if (hasChildren) setOpen((s) => ({ ...s, [item.id]: !s[item.id] }));
                        if (onNavigate) onNavigate(item.id);
                      }}
                    >
                      <Icon name={item.icon || "circle"} size={16} />
                      {!collapsed ? <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span> : null}
                      {!collapsed && item.count != null ? <span className="qos-nav-item-count">{item.count}</span> : null}
                      {!collapsed && hasChildren ? <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={13} style={{ color: "var(--text-tertiary)" }} /> : null}
                    </button>
                    {hasChildren && isOpen && !collapsed ? (
                      <div className="qos-nav-sub">
                        {item.children.map((c) => (
                          <button key={c.id} type="button" className="qos-nav-item" data-selected={activeId === c.id || undefined} onClick={() => onNavigate && onNavigate(c.id)}>
                            <span style={{ flex: 1, minWidth: 0 }}>{c.label}</span>
                            {c.count != null ? <span className="qos-nav-item-count">{c.count}</span> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {footer ? <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border-subtle)" }}>{footer}</div> : null}
    </nav>
  );
}
