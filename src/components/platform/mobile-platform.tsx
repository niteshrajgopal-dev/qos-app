"use client";

// Direct port of the design prototype. Markup and copy are kept as specified.
import React from "react";

import { usePlatformData } from "@/mocks/use-platform-data";
import { DefinitionList } from "@/components/platform/layout";
import { Button, Icon, Badge, StatusBadge, KpiCard, Alert, Timeline, Switch, Avatar, Toast, ToastStack, ConfirmDialog, SearchInput, Chip, Sparkline } from "@/design-system";

/* Mobile platform: monitoring and focused actions only (approve, pause, resolve).
   Configuration workflows stay on desktop, per the QOS responsive rules. */
const M_TABS = [
  { id: "home", label: "Home", icon: "layout-dashboard" },
  { id: "orders", label: "Orders", icon: "receipt", count: 3 },
  { id: "locations", label: "Locations", icon: "map-pin" },
  { id: "more", label: "More", icon: "menu" },
];

export function MHeader({ title, sub, right, onBack }: { title: React.ReactNode; sub?: string; right?: React.ReactNode; onBack?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 12px", minHeight: 56 }}>
      {onBack ? <button type="button" onClick={onBack} style={{ width: 36, height: 36, marginLeft: -8, border: "none", background: "none", display: "grid", placeItems: "center", color: "var(--text-primary)", cursor: "pointer" }}><Icon name="chevron-left" size={20} /></button> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 22, lineHeight: "28px", fontWeight: 600, letterSpacing: "-.015em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {sub ? <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1 }}>{sub}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function MCard({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return <Tag type={onClick ? "button" : undefined} onClick={onClick} style={{ textAlign: "left", background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, boxShadow: "var(--shadow-sm)", color: "inherit", font: "inherit", cursor: onClick ? "pointer" : undefined, width: "100%", ...style }}>{children}</Tag>;
}

export function MobilePlatform({ theme = "light" }) {
  const platform = usePlatformData();
  type Order = typeof platform.ORDERS[number];
  const [tab, setTab] = React.useState("home");
  const [order, setOrder] = React.useState<Order | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [resolved, setResolved] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState<Record<string, boolean>>({ jbr: true });
  const [view, setView] = React.useState("exceptions");

  const orders = view === "exceptions" ? platform.ORDERS.filter((o) => o.exception) : platform.ORDERS;

  const body = order ? (
    <>
      <MHeader title={<span style={{ fontFamily: "var(--font-mono)" }}>{order.id}</span>} sub={`${order.channel} · ${order.location} · ${order.time}`} onBack={() => setOrder(null)} right={<StatusBadge state={order.state} />} />
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 12 }}>
        {order.exception ? <Alert tone="error" title="Not sent to the POS">Lightspeed returned 502 on 3 attempts. The customer has paid AED {order.amount}.</Alert> : null}
        <MCard>
          <DefinitionList items={[
            { label: "Customer", value: order.customer },
            { label: "Payment", value: `${order.payment} · AED ${order.amount}` },
            { label: "Fulfilment", value: order.fulfilment },
          ]} />
        </MCard>
        <MCard>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Items</div>
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            {[["2 × Flat white", "48.00"], ["1 × Avocado toast", "38.00"], ["1 × Cold brew", "22.00"]].map(([n, p]) => <div key={n} style={{ display: "flex", justifyContent: "space-between" }}><span>{n}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{p}</span></div>)}
          </div>
        </MCard>
        <MCard>
          <Timeline items={[
            { title: "Order placed", meta: `${order.time} · ${order.channel}`, tone: "success", icon: "check" },
            { title: "Payment authorised", meta: "Stripe", tone: "success", icon: "credit-card" },
            order.exception ? { title: "Send to POS failed (3 of 3)", meta: "14:07 · 502 Bad Gateway", tone: "error", icon: "x-circle" } : { title: "Sent to POS", meta: "Lightspeed", tone: "success", icon: "check" },
          ]} />
        </MCard>
        {order.exception ? <Button size="lg" fullWidth icon="refresh-cw" onClick={() => { setToast(`${order.id} resent to Lightspeed`); setOrder(null); }}>Resend to POS</Button> : null}
        <Button size="lg" variant="secondary" fullWidth icon="phone">Call customer</Button>
      </div>
    </>
  ) : tab === "home" ? (
    <>
      <MHeader title="Good morning, Jamie" sub="Quotes · 12 locations · 4 channels" right={<Avatar name="Jamie Doyle" size="sm" />} />
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600, color: "var(--text-secondary)" }}>Needs attention</div>
        {!resolved ? (
          <div className="qos-card" data-tone="intelligence" style={{ padding: 14, borderRadius: 12, border: "1px solid var(--intelligence-border)", background: "var(--intelligence-surface)", position: "relative", overflow: "hidden" }}>
            <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "var(--qos-gradient)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><Badge tone="intelligence" icon="sparkles">Anomaly</Badge><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>High confidence</span></div>
            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: "20px" }}>Delivery orders down 34% at Marina Walk</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, lineHeight: "18px" }}><strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>System fact</strong> · 18 delivery orders in 2h against 27 expected. <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>AI recommendation</strong> · Reconnect Lightspeed and replay 9 orders.</p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button variant="intelligence" icon="check" fullWidth onClick={() => setConfirm(true)}>Approve and reconnect</Button>
            </div>
          </div>
        ) : (
          <Alert tone="success" title="Lightspeed reconnected">9 orders replayed. Marina Walk is accepting delivery orders again.</Alert>
        )}
        <MCard onClick={() => { setTab("orders"); setView("exceptions"); }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--status-error-bg)", color: "var(--status-error-fg)", display: "grid", placeItems: "center" }}><Icon name="alert-circle" size={16} /></span>
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>3 order exceptions</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>2 not sent to POS · 1 payment pending</span></span>
            <Icon name="chevron-right" size={16} style={{ color: "var(--text-tertiary)" }} />
          </div>
        </MCard>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600, color: "var(--text-secondary)", marginTop: 8 }}>Today</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <KpiCard label="Orders" value="1,284" delta="12%" deltaDirection="up" />
          <KpiCard label="Revenue" value="48,210" unit="AED" delta="4%" deltaDirection="down" />
        </div>
        <MCard>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div><div className="qos-kpi-label">Orders, last 24h</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Peak 55 at 18:00</div></div>
            <Sparkline values={platform.ORDER_TREND} tone="var(--viz-1)" />
          </div>
        </MCard>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600, color: "var(--text-secondary)", marginTop: 8 }}>Channels</div>
        <MCard style={{ padding: 0 }}>
          {platform.CHANNELS.slice(0, 4).map((c, i) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: i < 3 ? "1px solid var(--border-subtle)" : "none" }}>
              <Icon name={c.icon} size={15} style={{ color: "var(--text-secondary)" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>{c.name}</span>
              <StatusBadge state={c.state} />
            </div>
          ))}
        </MCard>
      </div>
    </>
  ) : tab === "orders" ? (
    <>
      <MHeader title="Orders" sub="Live, all channels" right={<Badge tone="error" icon="alert-triangle">3</Badge>} />
      <div style={{ padding: "0 16px 12px", display: "flex", gap: 8, overflowX: "auto", whiteSpace: "nowrap", scrollbarWidth: "none" }}>
        <span style={{ flex: "none" }}><Chip icon="alert-triangle" selected={view === "exceptions"} count={3} onClick={() => setView("exceptions")}>Exceptions</Chip></span>
        <span style={{ flex: "none" }}><Chip selected={view === "all"} onClick={() => setView("all")}>All</Chip></span>
        <span style={{ flex: "none" }}><Chip>Marina Walk</Chip></span>
      </div>
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 10 }}>
        {orders.map((o) => (
          <MCard key={o.id} onClick={() => setOrder(o)} style={o.exception ? { borderColor: "var(--status-error-border)" } as React.CSSProperties : undefined}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{o.id}</span><span style={{ color: "var(--text-secondary)" }}>{o.customer}</span></span>
                <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{o.channel} · {o.location} · {o.fulfilment} · {o.time}</span>
                {o.issue ? <span style={{ display: "inline-block", marginTop: 6 }}><Badge tone="error" icon="alert-circle">{o.issue}</Badge></span> : null}
              </span>
              <span style={{ textAlign: "right" }}><span style={{ display: "block", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{o.amount}</span><StatusBadge state={o.state} /></span>
            </div>
          </MCard>
        ))}
      </div>
    </>
  ) : tab === "locations" ? (
    <>
      <MHeader title="Locations" sub="12 locations · 1 warning" />
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 10 }}>
        {platform.LOCATIONS.map((l) => (
          <MCard key={l.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{l.name}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{paused[l.id] ? "Paused · not taking orders" : l.hours}</span>
              </span>
              <StatusBadge state={paused[l.id] ? "paused" : l.state} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{l.channels}</span>
              <Switch label="Taking orders" checked={!paused[l.id]} onChange={(e) => { setPaused({ ...paused, [l.id]: !e.target.checked }); setToast(e.target.checked ? `${l.name} is taking orders again` : `${l.name} paused on all channels`); }} />
            </div>
          </MCard>
        ))}
      </div>
    </>
  ) : (
    <>
      <MHeader title="More" right={<Avatar name="Jamie Doyle" size="sm" />} />
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 12 }}>
        <MCard style={{ padding: 0 }}>
          {[["package", "Catalogue availability", "Pause items, mark sold out"], ["store", "Sales channels", "Status only"], ["plug", "Integrations", "Health and reconnect"], ["bar-chart-3", "Analytics", "Today and 7 days"]].map(([ic, t, s], i) => (
            <button key={t} type="button" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", border: "none", borderBottom: i < 3 ? "1px solid var(--border-subtle)" : "none", background: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer", minHeight: 52 }}>
              <Icon name={ic} size={16} style={{ color: "var(--text-secondary)" }} />
              <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{t}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{s}</span></span>
              <Icon name="chevron-right" size={16} style={{ color: "var(--text-tertiary)" }} />
            </button>
          ))}
        </MCard>
        <Alert tone="info" title="Configuration stays on desktop">Menus, storefront, team and integration setup are desktop-only. This app is for monitoring and focused actions.</Alert>
        <MCard style={{ padding: 0 }}>
          {[["building-2", "Switch business", "Quotes"], ["settings", "Preferences", ""], ["log-out", "Sign out", ""]].map(([ic, t, s], i) => (
            <button key={t} type="button" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", border: "none", borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none", background: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer", minHeight: 48 }}>
              <Icon name={ic} size={16} style={{ color: "var(--text-secondary)" }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{t}</span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{s}</span>
            </button>
          ))}
        </MCard>
      </div>
    </>
  );

  return (
    <div data-qos-theme={theme} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)", position: "relative" }}>
      <div style={{ height: 54, flex: "none" }} />
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>{body}</div>
      {!order ? (
        <nav style={{ flex: "none", display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-default)", padding: "6px 8px 28px" }}>
          {M_TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{ position: "relative", display: "grid", justifyItems: "center", gap: 3, minHeight: 48, padding: "6px 0", border: "none", background: "none", color: tab === t.id ? "var(--text-brand)" : "var(--text-secondary)", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
              <Icon name={t.icon} size={20} />{t.label}
              {t.count ? <span style={{ position: "absolute", top: 2, left: "calc(50% + 6px)", minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "var(--status-error-solid)", color: "#fff", fontSize: 10, fontWeight: 600, display: "grid", placeItems: "center" }}>{t.count}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}
      {confirm ? (
        <div onClick={() => setConfirm(false)} style={{ position: "absolute", inset: 0, background: "rgba(11,15,26,.48)", display: "grid", alignItems: "end", zIndex: 30 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface-default)", borderRadius: "16px 16px 0 0", padding: "20px 20px 36px", display: "grid", gap: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Reconnect Lightspeed and replay 9 orders?</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: "18px" }}>This re-authorises the POS connector for all 12 locations and resends 9 failed orders. Customers will not be charged again.</p>
            <Button size="lg" variant="intelligence" fullWidth onClick={() => { setConfirm(false); setResolved(true); setToast("Lightspeed reconnected · 9 orders replayed"); }}>Approve and reconnect</Button>
            <Button size="lg" variant="ghost" fullWidth onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 100, zIndex: 40 }}>
          <Toast tone="success" title="Done" onDismiss={() => setToast(null)}>{toast}</Toast>
        </div>
      ) : null}
    </div>
  );
}
