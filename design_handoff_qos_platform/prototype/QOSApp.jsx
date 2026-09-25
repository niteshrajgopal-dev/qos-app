/* Combined QOS prototype bundle — generated from kit/*.jsx. Edit the source files and rebuild. */

/* ---- data.js ---- */
{
/* Fake data for the QOS platform UI kit. Object names follow the qosapp domain model
   (tenants → organizations → brands → locations; storefronts, releases, catalogue, menus). */
const TENANTS = [
  { id: "quotes", name: "Quotes", meta: "12 locations · AED · hospitality" },
  { id: "petal", name: "Petal & Stem", meta: "3 locations · AED · generic retail" },
];

const NAV = [
  { items: [
    { id: "home", label: "Home", icon: "layout-dashboard" },
    { id: "orders", label: "Orders", icon: "receipt", count: 9 },
  ] },
  { label: "Commerce", items: [
    { id: "catalogue", label: "Catalogue", icon: "package", children: [
      { id: "catalogue", label: "Products", count: 1583 },
      { id: "menus", label: "Menus", count: 6 },
      { id: "modifiers", label: "Modifier groups", count: 24 },
      { id: "categories", label: "Categories", count: 18 },
    ] },
    { id: "customers", label: "Customers", icon: "users" },
    { id: "channels", label: "Sales Channels", icon: "store", children: [
      { id: "channels", label: "All channels" },
      { id: "store", label: "Online Store" },
      { id: "pos", label: "POS" },
    ] },
    { id: "locations", label: "Locations", icon: "map-pin", count: 12 },
  ] },
  { label: "Platform", items: [
    { id: "integrations", label: "Integrations", icon: "plug", count: 2 },
    { id: "analytics", label: "Analytics", icon: "bar-chart-3" },
    { id: "team", label: "Team", icon: "shield-check" },
    { id: "settings", label: "Settings", icon: "settings" },
  ] },
];

const ORDERS = [
  { id: "QO-10428", customer: "A. Rahman", channel: "Online Store", location: "Marina Walk", state: "failed", fulfilment: "Delivery", payment: "Authorised", amount: "184.00", time: "14:06", exception: true, issue: "Not sent to POS" },
  { id: "QO-10427", customer: "L. Fernandes", channel: "POS", location: "Downtown", state: "live", fulfilment: "Dine-in", payment: "Paid", amount: "62.50", time: "14:04" },
  { id: "QO-10426", customer: "S. Habib", channel: "Deliveroo", location: "Marina Walk", state: "processing", fulfilment: "Delivery", payment: "Paid", amount: "96.00", time: "14:01" },
  { id: "QO-10425", customer: "M. Okafor", channel: "Online Store", location: "Al Quoz", state: "published", fulfilment: "Collection", payment: "Paid", amount: "241.75", time: "13:58" },
  { id: "QO-10424", customer: "N. Sharma", channel: "Online Store", location: "Marina Walk", state: "failed", fulfilment: "Delivery", payment: "Authorised", amount: "77.25", time: "13:54", exception: true, issue: "Not sent to POS" },
  { id: "QO-10423", customer: "K. Mensah", channel: "POS", location: "Downtown", state: "published", fulfilment: "Dine-in", payment: "Paid", amount: "128.00", time: "13:49" },
  { id: "QO-10422", customer: "R. Iyer", channel: "Talabat", location: "Al Quoz", state: "paused", fulfilment: "Delivery", payment: "Pending", amount: "54.00", time: "13:41", exception: true, issue: "Payment pending 24m" },
  { id: "QO-10421", customer: "D. Costa", channel: "Online Store", location: "Marina Walk", state: "published", fulfilment: "Collection", payment: "Paid", amount: "33.50", time: "13:37" },
];

const PRODUCTS = [
  { id: "flat-white", name: "Flat white", category: "Coffee", variants: 3, price: "18.00 – 24.00", state: "published", channels: "Online Store, POS, Deliveroo", availability: "12 of 12" },
  { id: "cortado", name: "Cortado", category: "Coffee", variants: 2, price: "16.00", state: "published", channels: "Online Store, POS", availability: "12 of 12" },
  { id: "cold-brew", name: "Cold brew", category: "Coffee", variants: 2, price: "22.00", state: "draft", channels: "—", availability: "0 of 12" },
  { id: "avo-toast", name: "Avocado toast", category: "Kitchen", variants: 1, price: "38.00", state: "published", channels: "Online Store, POS", availability: "9 of 12", exception: true },
  { id: "banana-bread", name: "Banana bread", category: "Bakery", variants: 1, price: "21.00", state: "published", channels: "Online Store, POS, Talabat", availability: "12 of 12" },
  { id: "matcha-latte", name: "Matcha latte", category: "Tea", variants: 3, price: "24.00 – 29.00", state: "archived", channels: "—", availability: "0 of 12" },
];

const LOCATIONS = [
  { id: "marina", name: "Marina Walk", city: "Dubai Marina", state: "warning", channels: "Online Store, POS, Deliveroo", fulfilment: "Delivery, Collection, Dine-in", hours: "Open until 23:00", integration: "error", exception: true },
  { id: "downtown", name: "Downtown", city: "Sheikh Mohammed Bin Rashid Blvd", state: "active", channels: "Online Store, POS", fulfilment: "Collection, Dine-in", hours: "Open until 00:00", integration: "connected" },
  { id: "alquoz", name: "Al Quoz", city: "Alserkal Avenue", state: "active", channels: "Online Store, POS, Talabat", fulfilment: "Delivery, Collection", hours: "Open until 22:00", integration: "connected" },
  { id: "jbr", name: "JBR Beachfront", city: "Jumeirah Beach Residence", state: "paused", channels: "Online Store", fulfilment: "Collection", hours: "Closed · reopens 07:00", integration: "connected" },
];

const CHANNELS = [
  { id: "store", name: "Online Store", kind: "QOS Storefront", icon: "globe", state: "live", locations: "12 of 12", catalogue: "Main menu", sync: "synced", activity: "Release 42 published 4h ago", domain: "quotes.qosapp.com" },
  { id: "pos", name: "Lightspeed POS", kind: "Point of sale", icon: "monitor", state: "error", locations: "12 of 12", catalogue: "Mirrored", sync: "out_of_sync", activity: "9 orders failed since 14:02" },
  { id: "deliveroo", name: "Deliveroo", kind: "Delivery marketplace", icon: "truck", state: "live", locations: "4 of 12", catalogue: "Delivery menu", sync: "synced", activity: "Menu synced 20m ago" },
  { id: "talabat", name: "Talabat", kind: "Delivery marketplace", icon: "truck", state: "paused", locations: "2 of 12", catalogue: "Delivery menu", sync: "synced", activity: "Paused by Jamie Doyle 2d ago" },
  { id: "kiosk", name: "Self-order kiosk", kind: "In-store", icon: "tablet", state: "available", locations: "—", catalogue: "—", sync: "disconnected", activity: "Not connected" },
  { id: "whatsapp", name: "WhatsApp ordering", kind: "Messaging", icon: "message-circle", state: "available", locations: "—", catalogue: "—", sync: "disconnected", activity: "Not connected" },
];

const INTEGRATIONS = [
  { id: "lightspeed", name: "Lightspeed", kind: "POS", state: "error", health: "9 failed calls in the last hour", locations: "12 mapped", icon: "monitor" },
  { id: "stripe", name: "Stripe", kind: "Payments", state: "connected", health: "Healthy · 0 failures today", locations: "12 mapped", icon: "credit-card" },
  { id: "deliveroo", name: "Deliveroo", kind: "Delivery", state: "connected", health: "Healthy · menu synced 20m ago", locations: "4 mapped", icon: "truck" },
  { id: "talabat", name: "Talabat", kind: "Delivery", state: "config_required", health: "Location mapping incomplete", locations: "2 of 3 mapped", icon: "truck" },
  { id: "xero", name: "Xero", kind: "Accounting", state: "available", health: "Not connected", locations: "—", icon: "book-open" },
  { id: "klaviyo", name: "Klaviyo", kind: "CRM", state: "available", health: "Not connected", locations: "—", icon: "users" },
  { id: "finedine", name: "FineDine", kind: "Menu import", state: "connected", health: "Healthy · last import 2d ago", locations: "12 mapped", icon: "package" },
  { id: "twilio", name: "Twilio", kind: "Messaging", state: "available", health: "Not connected", locations: "—", icon: "message-circle" },
];

const RELEASES = [
  { id: 42, version: "Release 42", date: "12 Sep 2026, 09:14", user: "Jamie Doyle", changes: "Homepage hero, 3 pages, opening hours", state: "published", active: true },
  { id: 41, version: "Release 41", date: "08 Sep 2026, 17:02", user: "Priya Nair", changes: "Menu assignment, footer links", state: "published" },
  { id: 40, version: "Release 40", date: "02 Sep 2026, 11:20", user: "Jamie Doyle", changes: "Brand colours, logo", state: "published" },
  { id: 39, version: "Release 39", date: "29 Aug 2026, 08:47", user: "System", changes: "Domain verification", state: "failed" },
];

const ORDER_TREND = [12, 18, 15, 24, 21, 30, 27, 34, 29, 38, 31, 26, 44, 39, 47, 41, 52, 48, 55, 43, 38, 30, 22, 16];
const REVENUE_TREND = [8, 12, 11, 18, 16, 22, 20, 26, 23, 30, 26, 21, 34, 31, 37, 33, 41, 38, 44, 35, 30, 24, 18, 13];

const BLOCKS = [
  { id: "hero", name: "Hero", icon: "image", note: "Image, headline, order button", state: "published" },
  { id: "categories", name: "Category navigation", icon: "layout-grid", note: "6 categories from Main menu", state: "published" },
  { id: "featured", name: "Featured products", icon: "star", note: "4 products · manual selection", state: "draft" },
  { id: "story", name: "Story / brand content", icon: "book-open", note: "Two columns, image left", state: "published" },
  { id: "locations", name: "Locations", icon: "map-pin", note: "All 12 locations, map", state: "published" },
  { id: "hours", name: "Opening hours", icon: "clock", note: "Pulled from location hours", state: "published" },
  { id: "footer", name: "Footer", icon: "panel-bottom", note: "Links, socials, legal", state: "published" },
];

Object.assign(window, { TENANTS, NAV, ORDERS, PRODUCTS, LOCATIONS, CHANNELS, INTEGRATIONS, RELEASES, ORDER_TREND, REVENUE_TREND, BLOCKS });

}

/* ---- AppShell.jsx ---- */
{
const { SideNav, TopBar, TenantSwitcher, SearchInput, IconButton, Avatar, Badge, Logo, Banner, Button, CommandPalette } = window.QOSDesignSystem_913581;

function AppShell({ screen, onNavigate, tenant, onTenantChange, banner, children, theme = "light", onThemeChange }) {
  const [cmd, setCmd] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [vw, setVw] = React.useState(window.innerWidth);
  const narrow = vw < 1180, phone = vw < 768;
  const [collapsed, setCollapsed] = React.useState(() => { const v = localStorage.getItem("qos-nav-collapsed"); return v != null ? v === "1" : window.innerWidth < 1180; });
  const toggleNav = () => setCollapsed((c) => { localStorage.setItem("qos-nav-collapsed", c ? "0" : "1"); return !c; });
  React.useEffect(() => { const r = () => setVw(window.innerWidth); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const navOverlay = phone && !collapsed;
  const go = (id) => { onNavigate(id); if (phone) setCollapsed(true); };
  React.useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmd(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div data-qos-theme={theme} style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--surface-canvas)", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", flex: "none", width: phone ? "var(--layout-nav-width-collapsed)" : undefined, position: "relative", zIndex: 30 }}>
        <div style={{ display: "flex", height: "100%", position: navOverlay ? "absolute" : "relative", top: 0, left: 0, boxShadow: navOverlay ? "var(--shadow-xl)" : "none" }}>
        <SideNav
          collapsed={collapsed}
          brand={collapsed ? <img src="assets/app-icon.png" alt="QOS" style={{ width: 28, height: 28, borderRadius: 8, display: "block" }} /> : <Logo variant={theme === "dark" ? "navy" : "light"} height={17} assetBase="assets/" />}
          groups={window.NAV}
          activeId={screen}
          onNavigate={go}
          footer={collapsed ? <button type="button" className="qos-nav-item" title="Jamie Doyle" style={{ height: 40, justifyContent: "center" }}><Avatar name="Jamie Doyle" size="sm" /></button> : 
            <button type="button" className="qos-nav-item" style={{ height: 40 }}>
              <Avatar name="Jamie Doyle" size="sm" />
              <span style={{ flex: 1, minWidth: 0, textAlign: "left", lineHeight: 1.2 }}>
                Jamie Doyle
                <span style={{ display: "block", fontSize: 10, color: "var(--text-tertiary)", fontWeight: 400 }}>Administrator</span>
              </span>
            </button>
          }
        />
        </div>
      </div>
      {navOverlay ? <div onClick={() => setCollapsed(true)} style={{ position: "fixed", inset: 0, background: "rgba(11,15,26,.48)", zIndex: 20 }} /> : null}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar>
          <IconButton icon={collapsed ? "panel-left-open" : "panel-left-close"} label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={toggleNav} />
          <TenantSwitcher tenants={window.TENANTS} value={tenant} onChange={onTenantChange} />
          <button type="button" onClick={() => setCmd(true)} style={{ flex: 1, minWidth: 0, maxWidth: 380, height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--surface-subtle)", color: "var(--text-placeholder)", fontSize: 13, cursor: "pointer", overflow: "hidden" }}>
            <span className="qos-badge" style={{ border: "none", background: "none", padding: 0, color: "var(--text-tertiary)", flex: "none" }}>⌕</span>
            {phone ? null : <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>Search businesses, orders, products, locations…</span>}
            {narrow ? null : <span className="qos-kbd" style={{ flex: "none" }}>⌘K</span>}
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            {narrow ? null : <Badge tone="processing" dot pulse>Development</Badge>}
            <IconButton
              icon={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => onThemeChange && onThemeChange(theme === "dark" ? "light" : "dark")}
            />
            {phone ? null : <IconButton icon="circle-help" label="Help" />}
            <span style={{ position: "relative", display: "inline-flex" }}>
              <IconButton icon="bell" label="Notifications" />
              <span style={{ position: "absolute", top: 5, right: 5, width: 7, height: 7, borderRadius: 999, background: "var(--status-error-solid)", border: "1.5px solid var(--surface-default)" }} />
            </span>
            <Avatar name="Jamie Doyle" size="sm" />
          </div>
        </TopBar>
        {banner}
        <main style={{ flex: 1, overflow: "auto" }}>
          <div style={{ maxWidth: "var(--layout-canvas-max)", minWidth: phone ? 720 : undefined, margin: "0 auto", padding: "24px var(--layout-gutter) 64px" }}>{children}</div>
        </main>
      </div>
      <CommandPalette
        open={cmd}
        query={q}
        onQueryChange={setQ}
        onClose={() => setCmd(false)}
        onSelect={(it) => { setCmd(false); if (it.screen) onNavigate(it.screen); }}
        groups={[
          { label: "Suggested by QOS Intelligence", items: [
            { id: "ai1", label: "9 orders failed to reach Lightspeed", meta: "Marina Walk · since 14:02", kind: "Anomaly", intelligence: true, screen: "orders" },
          ] },
          { label: "Orders", items: [
            { id: "o1", label: "QO-10428 · A. Rahman", meta: "Online Store · 184.00 AED", kind: "Order", icon: "receipt", screen: "orders" },
            { id: "o2", label: "QO-10427 · L. Fernandes", meta: "POS · 62.50 AED", kind: "Order", icon: "receipt", screen: "orders" },
          ] },
          { label: "Catalogue", items: [
            { id: "p1", label: "Flat white", meta: "Coffee · 3 variants", kind: "Product", icon: "package", screen: "catalogue" },
            { id: "p2", label: "Main menu", meta: "6 sections · 84 items", kind: "Menu", icon: "book-open", screen: "catalogue" },
          ] },
          { label: "Locations", items: [
            { id: "l1", label: "Marina Walk", meta: "Integration error", kind: "Location", icon: "map-pin", screen: "locations" },
          ] },
        ]}
      />
    </div>
  );
}

function Section({ title, action, children, style }) {
  return (
    <section style={{ marginTop: "var(--section-gap)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: "var(--text-section-size)", lineHeight: "var(--text-section-lh)", fontWeight: "var(--fw-semibold)", letterSpacing: "var(--text-section-ls)" }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Grid({ cols = 4, children, gap = 16, style }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, ...style }}>{children}</div>;
}

function DefinitionList({ items }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 20px", margin: 0, fontSize: 13 }}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <dt style={{ color: "var(--text-secondary)" }}>{it.label}</dt>
          <dd style={{ margin: 0, fontWeight: "var(--fw-medium)" }}>{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

Object.assign(window, { AppShell, Section, Grid, DefinitionList });

}

/* ---- LoginScreen.jsx ---- */
{
const { Logo, Button, Input, Card, Avatar, Badge, StatusBadge } = window.QOSDesignSystem_913581;

/* Flow 1, step 1 — login, then tenant selection. The brand is loud here and quiet everywhere else. */
function LoginScreen({ onSignIn, step, tenant, onPickTenant }) {
  return (
    <div data-qos-theme="dark" style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.15fr 1fr", background: "var(--surface-canvas)", color: "var(--text-primary)" }}>
      <div style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 48px" }}>
        <img src="assets/motif-orbital-hero.png" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,7,14,.35), rgba(5,7,14,.85))" }} />
        <Logo variant="navy" height={26} assetBase="assets/" style={{ position: "relative" }} />
        <div style={{ position: "relative", maxWidth: 460 }}>
          <h1 style={{ fontSize: 40, lineHeight: "48px", letterSpacing: "-.02em", fontWeight: 600 }}>Ideas today.<br />Impact tomorrow.</h1>
          <p style={{ marginTop: 14, fontSize: 16, lineHeight: "24px", color: "var(--text-secondary)" }}>
            The orchestration layer for your commerce operations — channels, catalogue, locations and integrations in one place.
          </p>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 24, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          <span>Higher quality</span><span>Brighter possibilities</span>
        </div>
      </div>
      <div style={{ display: "grid", placeItems: "center", padding: 40, background: "var(--surface-default)" }}>
        {step === "login" ? (
          <div style={{ width: "100%", maxWidth: 340, display: "grid", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-.015em" }}>Sign in to QOS</h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>Use your work account.</p>
            </div>
            <Input id="email" label="Work email" defaultValue="jamie.doyle@quotes.ae" />
            <Input id="pw" label="Password" type="password" defaultValue="••••••••••" />
            <Button size="lg" fullWidth iconTrailing="arrow-right" onClick={onSignIn}>Continue</Button>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center" }}>
              Trouble signing in? <a href="#">Request staff access</a>
            </div>
          </div>
        ) : (
          <div style={{ width: "100%", maxWidth: 380, display: "grid", gap: 14 }}>
            <div>
              <h2 style={{ fontSize: 24, lineHeight: "32px", fontWeight: 600, letterSpacing: "-.015em" }}>Choose a business</h2>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>You have access to 2 businesses on this platform.</p>
            </div>
            {window.TENANTS.map((t) => (
              <button key={t.id} type="button" onClick={() => onPickTenant(t.id)} className="qos-card" data-padding="sm" data-interactive="true" style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer" }}>
                <Avatar name={t.name} tone="brand" size="lg" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>{t.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{t.meta}</span>
                </span>
                {t.id === "quotes" ? <StatusBadge state="live" /> : <Badge tone="neutral">Retail</Badge>}
              </button>
            ))}
            <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Quotes is Customer #1 on the shared QOS Storefront Platform.</p>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });

}

/* ---- HomeScreen.jsx ---- */
{
const { PageHeader, KpiCard, Card, Button, StatusBadge, Badge, TrendChart, SegmentedControl, IntelligenceCard, Alert, Timeline, Icon, Sparkline, Avatar, ConfirmDialog, Toast, ToastStack } = window.QOSDesignSystem_913581;

/* Flow 1 — situational awareness. Flow 8 — dashboard anomaly to approved action.
   Exceptions and next actions come before metrics. */
function HomeScreen({ onNavigate }) {
  const [range, setRange] = React.useState("Today");
  const [confirm, setConfirm] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [resolved, setResolved] = React.useState(false);
  return (
    <>
      <PageHeader
        title="Good morning, Jamie"
        subtitle="Quotes · 12 locations · 4 sales channels. Two things need your attention."
        actions={<>
          <SegmentedControl options={["Today", "7 days", "30 days"]} value={range} onChange={setRange} />
          <Button variant="secondary" icon="download">Export</Button>
        </>}
      />

      <window.Section title="Needs attention">
        <window.Grid cols={2}>
          {!resolved ? (
            <IntelligenceCard
              kind="Anomaly"
              title="Delivery orders down 34% at Marina Walk"
              confidence="High"
              claims={[
                { kind: "System fact", text: "18 delivery orders in the last two hours against 27 expected for this window." },
                { kind: "AI interpretation", text: "The Lightspeed POS connector has returned 502 responses since 14:02, so new orders are not reaching the kitchen." },
                { kind: "AI recommendation", text: "Reconnect Lightspeed for Marina Walk and replay the 9 failed orders." },
              ]}
              actions={<>
                <Button variant="intelligence" icon="check" onClick={() => setConfirm(true)}>Approve and reconnect</Button>
                <Button variant="ghost" onClick={() => onNavigate("integrations")}>View integration</Button>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-secondary)" }}>Nothing changes until you approve</span>
              </>}
            />
          ) : (
            <Alert tone="success" title="Lightspeed reconnected" actions={<Button size="sm" variant="secondary" onClick={() => onNavigate("orders")}>View replayed orders</Button>}>
              9 orders were replayed successfully. Marina Walk is accepting delivery orders again.
            </Alert>
          )}
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <Alert tone="error" title="2 orders failed to reach the POS" actions={<Button size="sm" variant="secondary" onClick={() => onNavigate("orders")}>Open exceptions</Button>}>
              QO-10428 and QO-10424 are paid but not sent. Marina Walk.
            </Alert>
            <Alert tone="warning" title="Talabat location mapping incomplete" actions={<Button size="sm" variant="secondary" onClick={() => onNavigate("integrations")}>Finish setup</Button>}>
              1 of 3 locations is unmapped, so its menu is not live.
            </Alert>
          </div>
        </window.Grid>
      </window.Section>

      <window.Section title="Today">
        <window.Grid cols={4}>
          <KpiCard label="Orders" value="1,284" delta="12%" deltaDirection="up" caption="vs. same day last week" icon="receipt" onClick={() => onNavigate("orders")} />
          <KpiCard label="Revenue" value="48,210" unit="AED" delta="4%" deltaDirection="down" caption="vs. same day last week" icon="wallet" />
          <KpiCard label="Average order value" value="37.55" unit="AED" delta="1.2%" deltaDirection="up" icon="scale" />
          <KpiCard label="Orders needing attention" value="9" delta="3 new" deltaDirection="up" caption="Payment or POS exceptions" icon="alert-triangle" onClick={() => onNavigate("orders")} />
        </window.Grid>
      </window.Section>

      <window.Grid cols={3} style={{ marginTop: 16, alignItems: "start" }}>
        <Card header="Orders and revenue" subtitle="Last 24 hours, all channels" style={{ gridColumn: "span 2" }} actions={<Badge tone="neutral">Updated 2m ago</Badge>}>
          <TrendChart
            series={[{ label: "Orders", values: window.ORDER_TREND }, { label: "Revenue", values: window.REVENUE_TREND }]}
            labels={["00:00", "06:00", "12:00", "18:00", "now"]}
            height={188}
          />
          <div className="qos-legend" style={{ marginTop: 12 }}>
            <span className="qos-legend-key"><span className="qos-legend-swatch" style={{ background: "var(--viz-1)" }} />Orders</span>
            <span className="qos-legend-key"><span className="qos-legend-swatch" style={{ background: "var(--viz-2)" }} />Revenue (AED, hundreds)</span>
          </div>
        </Card>
        <Card header="Channel health" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate("channels")}>All channels</Button>} padding="none">
          {window.CHANNELS.slice(0, 4).map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px var(--card-padding)", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", display: "grid", placeItems: "center", color: "var(--text-secondary)" }}><Icon name={c.icon} size={14} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.activity}</span>
              </span>
              <StatusBadge state={c.state} />
            </div>
          ))}
        </Card>
      </window.Grid>

      <window.Grid cols={3} style={{ marginTop: 16, alignItems: "start" }}>
        <Card header="What changed" subtitle="Publishing and configuration activity" style={{ gridColumn: "span 2" }}>
          <Timeline items={[
            { title: <>Release 42 published to <strong>quotes.qosapp.com</strong></>, meta: "09:14 · Jamie Doyle · Homepage hero, 3 pages, opening hours", tone: "success", icon: "upload-cloud" },
            { title: "Talabat channel paused", meta: "2d ago · Jamie Doyle", tone: "neutral", icon: "pause" },
            { title: "Main menu synced to Deliveroo", meta: "20m ago · System · 84 items", tone: "neutral", icon: "refresh-cw" },
            { title: "Lightspeed connector started failing", meta: "14:02 · System · 502 Bad Gateway", tone: "error", icon: "alert-circle" },
          ]} />
        </Card>
        <div style={{ display: "grid", gap: 16 }}>
          <Card padding="sm">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div><div className="qos-kpi-label">Storefront uptime</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>99.98%</div></div>
              <Sparkline values={[98, 99, 100, 99, 100, 100, 99, 100]} tone="var(--viz-3)" />
            </div>
          </Card>
          <Card header="Product availability" padding="sm">
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Out of stock</span><strong>4 items</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Paused by staff</span><strong>2 items</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Missing images</span><strong>11 items</strong></div>
            </div>
            <Button size="sm" variant="secondary" fullWidth style={{ marginTop: 12 }} onClick={() => onNavigate("catalogue")}>Review catalogue</Button>
          </Card>
        </div>
      </window.Grid>

      {confirm ? (
        <ConfirmDialog
          tone="default"
          title="Reconnect Lightspeed and replay 9 orders?"
          description="This re-authorises the POS connector for all 12 locations and resends 9 failed orders. Customers will not be charged again."
          confirmLabel="Approve and reconnect"
          onClose={() => setConfirm(false)}
          onConfirm={() => { setConfirm(false); setResolved(true); setToast("Lightspeed reconnected · 9 orders replayed"); }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <window.DefinitionList items={[
              { label: "Integration", value: "Lightspeed · POS" },
              { label: "Scope", value: "12 locations" },
              { label: "Orders to replay", value: "QO-10428, QO-10424 and 7 more" },
              { label: "Approved by", value: "Jamie Doyle (Administrator)" },
            ]} />
          </div>
        </ConfirmDialog>
      ) : null}
      {toast ? <ToastStack><Toast tone="success" title="Action approved" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

Object.assign(window, { HomeScreen });

}

/* ---- OrdersScreen.jsx ---- */
{
const { PageHeader, Card, Button, DataTable, TableToolbar, TableBulkBar, Pagination, SearchInput, Chip, StatusBadge, Badge, Drawer, Timeline, Alert, Tabs, IconButton, Select, Icon, Toast, ToastStack } = window.QOSDesignSystem_913581;

/* Flow 6 — order exception: list → problem order → failure detail → integration event → resolve. */
function OrdersScreen() {
  const [view, setView] = React.useState("exceptions");
  const [sel, setSel] = React.useState([]);
  const [open, setOpen] = React.useState(null);
  const [tab, setTab] = React.useState("lifecycle");
  const [toast, setToast] = React.useState(null);

  const rows = view === "exceptions" ? window.ORDERS.filter((o) => o.exception) : window.ORDERS;
  const columns = [
    { key: "id", header: "Order", sortable: true, render: (r) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{r.id}</span> },
    { key: "customer", header: "Customer" },
    { key: "channel", header: "Channel" },
    { key: "location", header: "Location" },
    { key: "fulfilment", header: "Fulfilment" },
    { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} /> },
    { key: "payment", header: "Payment", render: (r) => <span style={{ color: r.payment === "Paid" ? "var(--text-primary)" : "var(--status-warning-fg)" }}>{r.payment}</span> },
    { key: "issue", header: "Exception", render: (r) => r.issue ? <Badge tone="error" icon="alert-circle">{r.issue}</Badge> : <span style={{ color: "var(--text-tertiary)" }}>—</span> },
    { key: "amount", header: "Amount", numeric: true, render: (r) => <span>{r.amount}</span> },
    { key: "time", header: "Time", numeric: true },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Live order flow across every channel and location."
        badge={<Badge tone="error" icon="alert-triangle">3 exceptions</Badge>}
        actions={<><Button variant="secondary" icon="download">Export</Button><Button variant="secondary" icon="bookmark">Save view</Button></>}
      />
      <div style={{ marginTop: 20 }}>
        <Card padding="none">
          <TableToolbar>
            <SearchInput placeholder="Order ID, customer, phone" style={{ width: 240 }} />
            <Chip icon="alert-triangle" selected={view === "exceptions"} count={3} onClick={() => setView("exceptions")}>Exceptions</Chip>
            <Chip selected={view === "all"} onClick={() => setView("all")}>All orders</Chip>
            <Chip>Today</Chip>
            <Chip>All channels</Chip>
            <Chip>All locations</Chip>
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <IconButton icon="columns-3" label="Columns" variant="outline" />
              <IconButton icon="rows-3" label="Density" variant="outline" />
            </div>
          </TableToolbar>
          {sel.length ? (
            <TableBulkBar count={sel.length}>
              <Button size="sm" variant="secondary" icon="refresh-cw" onClick={() => { setToast(`${sel.length} orders queued for retry`); setSel([]); }}>Retry send to POS</Button>
              <Button size="sm" variant="secondary" icon="printer">Print</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel([])}>Clear</Button>
            </TableBulkBar>
          ) : null}
          <DataTable
            columns={columns}
            rows={rows}
            density="dense"
            selectable
            selectedIds={sel}
            onToggleRow={(id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])}
            onToggleAll={(n) => setSel(n ? rows.map((r) => r.id) : [])}
            onRowClick={(r) => { setOpen(r); setTab("lifecycle"); }}
            sortKey="id"
            sortDirection="desc"
          />
          <Pagination page={1} pageCount={view === "exceptions" ? 1 : 198} pageSize={rows.length} total={view === "exceptions" ? 3 : 1583} />
        </Card>
      </div>

      {open ? (
        <Drawer
          title={<span style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontFamily: "var(--font-mono)" }}>{open.id}</span><StatusBadge state={open.state} /></span>}
          description={`${open.channel} · ${open.location} · ${open.fulfilment} · ${open.time}`}
          onClose={() => setOpen(null)}
          footer={<>
            <Button variant="ghost">Refund</Button>
            <Button variant="secondary" icon="printer">Print</Button>
            <Button icon="refresh-cw" onClick={() => { setToast(`${open.id} resent to Lightspeed`); setOpen(null); }}>Resend to POS</Button>
          </>}
        >
          {open.exception ? (
            <Alert tone="error" title="Order has not reached the POS" style={{ marginBottom: 16 }}>
              Lightspeed returned <code>502 Bad Gateway</code> on 3 attempts. The customer has been charged and is expecting this order.
            </Alert>
          ) : null}
          <Tabs tabs={[{ id: "lifecycle", label: "Lifecycle" }, { id: "items", label: "Items", count: 3 }, { id: "integration", label: "Integration events", tone: open.exception ? "error" : undefined }]} value={tab} onChange={setTab} />
          <div style={{ marginTop: 18 }}>
            {tab === "lifecycle" ? (
              <div style={{ display: "grid", gap: 20 }}>
                <window.DefinitionList items={[
                  { label: "Customer", value: `${open.customer} · +971 50 •••• 41` },
                  { label: "Payment", value: `${open.payment} · Stripe · AED ${open.amount}` },
                  { label: "Location", value: open.location },
                  { label: "Fulfilment", value: `${open.fulfilment} · ASAP` },
                  { label: "Channel", value: open.channel },
                ]} />
                <Timeline items={[
                  { title: "Order placed", meta: `${open.time} · ${open.channel}`, tone: "success", icon: "check" },
                  { title: "Payment authorised", meta: `${open.time} · Stripe`, tone: "success", icon: "credit-card" },
                  { title: "Send to POS failed (attempt 3 of 3)", meta: "14:07 · Lightspeed · 502 Bad Gateway", tone: "error", icon: "x-circle" },
                  { title: "Awaiting operator action", meta: "Now", tone: "processing", icon: "clock" },
                ]} />
              </div>
            ) : null}
            {tab === "items" ? (
              <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                {[["2 × Flat white", "Oat milk, extra shot", "48.00"], ["1 × Avocado toast", "No chilli", "38.00"], ["1 × Cold brew", "", "22.00"]].map(([n, m, p]) => (
                  <div key={n} style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--border-subtle)" }}>
                    <span><strong style={{ fontWeight: 500 }}>{n}</strong>{m ? <span style={{ display: "block", color: "var(--text-secondary)", fontSize: 12 }}>{m}</span> : null}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{p}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginTop: 4 }}><span>Total</span><span style={{ fontVariantNumeric: "tabular-nums" }}>AED {open.amount}</span></div>
              </div>
            ) : null}
            {tab === "integration" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <window.DefinitionList items={[
                  { label: "Integration", value: "Lightspeed · POS" },
                  { label: "Endpoint", value: <code>POST /v3/orders</code> },
                  { label: "Attempts", value: "3 · last 14:07" },
                  { label: "Correlation ID", value: <code>ord_8f31c9a2</code> },
                ]} />
                <pre style={{ margin: 0, padding: 14, background: "var(--surface-sunken)", borderRadius: "var(--radius-card)", fontSize: 12, lineHeight: "18px", overflowX: "auto", color: "var(--text-secondary)" }}>{`14:07:02  POST /v3/orders  → 502 Bad Gateway
14:05:41  POST /v3/orders  → 502 Bad Gateway
14:04:12  POST /v3/orders  → 502 Bad Gateway
14:02:00  connector health → degraded`}</pre>
                <Button variant="secondary" icon="external-link">Open integration</Button>
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}
      {toast ? <ToastStack><Toast tone="success" title="Queued" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

Object.assign(window, { OrdersScreen });

}

/* ---- CatalogueScreen.jsx ---- */
{
const { PageHeader, Card, Button, DataTable, TableToolbar, TableBulkBar, Pagination, SearchInput, Chip, StatusBadge, Badge, Tabs, Breadcrumbs, Input, Select, Textarea, Switch, Checkbox, Banner, Toast, ToastStack, Icon, IconButton, Tag, EmptyState, AiBadge } = window.QOSDesignSystem_913581;

/* Flow 2 — catalogue → product → edit → modifiers/availability → save → success. */
function CatalogueScreen() {
  const [product, setProduct] = React.useState(null);
  const [sel, setSel] = React.useState([]);
  const [toast, setToast] = React.useState(null);
  if (product) return <ProductEditor product={product} onBack={() => setProduct(null)} onSaved={(m) => { setProduct(null); setToast(m); }} toast={toast} setToast={setToast} />;

  const columns = [
    { key: "name", header: "Product", sortable: true, render: (r) => (
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)", display: "grid", placeItems: "center", color: "var(--text-tertiary)" }}><Icon name="image" size={13} /></span>
        <span style={{ fontWeight: 500 }}>{r.name}</span>
      </span>
    ) },
    { key: "category", header: "Category" },
    { key: "variants", header: "Variants", numeric: true },
    { key: "price", header: "Price (AED)", numeric: true },
    { key: "channels", header: "Channel visibility", render: (r) => r.channels === "—" ? <span style={{ color: "var(--text-tertiary)" }}>—</span> : <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.channels}</span> },
    { key: "availability", header: "Locations", render: (r) => r.exception ? <Badge tone="warning" icon="alert-triangle">{r.availability}</Badge> : <span>{r.availability}</span> },
    { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} /> },
    { key: "act", header: "", width: 40, render: () => <IconButton icon="more-horizontal" label="Actions" size="sm" /> },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />}
        title="Products"
        subtitle="1,583 products across 18 categories. Availability is controlled per location and per channel."
        actions={<><Button variant="secondary" icon="upload">Import</Button><Button icon="plus">New product</Button></>}
        tabs={<Tabs tabs={[{ id: "all", label: "All", count: 1583 }, { id: "published", label: "Published", count: 1502 }, { id: "draft", label: "Drafts", count: 63 }, { id: "issues", label: "Needs attention", count: 15, tone: "warning" }, { id: "archived", label: "Archived", count: 18 }]} value="all" onChange={() => {}} />}
      />
      <div style={{ marginTop: 20 }}>
        <Card padding="none">
          <TableToolbar>
            <SearchInput placeholder="Search 1,583 products" style={{ width: 240 }} />
            <Chip>Category</Chip>
            <Chip>Channel</Chip>
            <Chip>Location</Chip>
            <Chip icon="alert-triangle" count={15}>Needs attention</Chip>
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <IconButton icon="columns-3" label="Columns" variant="outline" />
              <IconButton icon="rows-3" label="Density" variant="outline" />
            </div>
          </TableToolbar>
          {sel.length ? (
            <TableBulkBar count={sel.length}>
              <Button size="sm" variant="secondary" icon="eye">Change visibility</Button>
              <Button size="sm" variant="secondary" icon="tag">Set price</Button>
              <Button size="sm" variant="secondary" icon="map-pin">Location availability</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel([])}>Clear</Button>
            </TableBulkBar>
          ) : null}
          <DataTable
            columns={columns}
            rows={window.PRODUCTS}
            selectable
            selectedIds={sel}
            onToggleRow={(id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])}
            onToggleAll={(n) => setSel(n ? window.PRODUCTS.map((r) => r.id) : [])}
            onRowClick={(r) => setProduct(r)}
            sortKey="name"
          />
          <Pagination page={1} pageCount={264} pageSize={6} total={1583} />
        </Card>
      </div>
      {toast ? <ToastStack><Toast tone="success" title="Saved" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

function ProductEditor({ product, onBack, onSaved }) {
  const [tab, setTab] = React.useState("details");
  const [dirty, setDirty] = React.useState(false);
  const [delivery, setDelivery] = React.useState(true);
  return (
    <>
      {dirty ? (
        <div style={{ margin: "-24px calc(-1 * var(--layout-gutter)) 20px" }}>
          <Banner tone="warning" icon="circle-dot" actions={<><Button size="sm" variant="ghost" onClick={onBack}>Discard</Button><Button size="sm" icon="check" onClick={() => onSaved(`${product.name} updated · changes are live on 3 channels`)}>Save changes</Button></>}>
            Unsaved changes to <strong>{product.name}</strong>.
          </Banner>
        </div>
      ) : null}
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ id: "catalogue", label: "Catalogue" }, { id: "catalogue", label: "Products" }, { label: product.name }]} onNavigate={onBack} />}
        title={product.name}
        badge={<StatusBadge state={product.state} />}
        subtitle={`${product.category} · ${product.variants} variants · available at ${product.availability} locations`}
        actions={<><Button variant="ghost" onClick={onBack}>Cancel</Button><Button variant="secondary" icon="eye">Preview in store</Button><Button icon="check" onClick={() => onSaved(`${product.name} updated · changes are live on 3 channels`)}>Save</Button></>}
        tabs={<Tabs tabs={[{ id: "details", label: "Details" }, { id: "variants", label: "Variants", count: product.variants }, { id: "modifiers", label: "Modifiers", count: 2 }, { id: "availability", label: "Availability", tone: product.exception ? "warning" : undefined }, { id: "media", label: "Media" }, { id: "channels", label: "Channels" }]} value={tab} onChange={setTab} />}
      />
      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          {tab === "details" ? (
            <>
              <Card header="Product details">
                <div style={{ display: "grid", gap: 16, maxWidth: "var(--layout-form-max)" }}>
                  <Input id="pname" label="Display name" defaultValue={product.name} onChange={() => setDirty(true)} />
                  <Textarea id="pdesc" label="Description" rows={3} defaultValue="Double shot of our house espresso with velvet steamed milk." onChange={() => setDirty(true)} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Select id="pcat" label="Category" options={["Coffee", "Tea", "Bakery", "Kitchen"]} defaultValue={product.category} onChange={() => setDirty(true)} />
                    <Input id="psku" label="SKU" leadingIcon="hash" defaultValue="QTS-0142" onChange={() => setDirty(true)} />
                  </div>
                </div>
              </Card>
              <Card header="Pricing" subtitle="Base prices apply everywhere unless a location override exists.">
                <div style={{ display: "grid", gap: 12 }}>
                  {[["Small", "18.00"], ["Regular", "21.00"], ["Large", "24.00"]].map(([n, p]) => (
                    <div key={n} style={{ display: "grid", gridTemplateColumns: "1fr 140px 150px", gap: 12, alignItems: "end" }}>
                      <Input id={`v${n}`} label={n === "Small" ? "Variant" : undefined} defaultValue={n} onChange={() => setDirty(true)} />
                      <Input id={`p${n}`} label={n === "Small" ? "Price (AED)" : undefined} defaultValue={p} onChange={() => setDirty(true)} />
                      <Select id={`o${n}`} label={n === "Small" ? "Location overrides" : undefined} options={["None", "2 locations"]} onChange={() => setDirty(true)} />
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" icon="plus" style={{ justifySelf: "start" }}>Add variant</Button>
                </div>
              </Card>
            </>
          ) : null}
          {tab === "modifiers" ? (
            <Card header="Modifier groups" subtitle="Groups are reusable across products." actions={<Button size="sm" variant="secondary" icon="plus">Attach group</Button>}>
              <div style={{ display: "grid", gap: 10 }}>
                {[["Milk", "Required · choose 1", 5], ["Extras", "Optional · choose up to 3", 7]].map(([n, rule, count]) => (
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)" }}>
                    <Icon name="list" size={15} style={{ color: "var(--text-tertiary)" }} />
                    <span style={{ flex: 1 }}><strong style={{ fontWeight: 500, fontSize: 13 }}>{n}</strong><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{rule} · {count} options</span></span>
                    <Badge tone="neutral">{count} options</Badge>
                    <IconButton icon="pencil" label="Edit group" size="sm" />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          {tab === "availability" ? (
            <Card header="Location availability" subtitle="Turn a product off at a single branch without unpublishing it." padding="none">
              <div style={{ padding: "var(--card-padding)", display: "grid", gap: 12 }}>
                {window.LOCATIONS.map((l) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ flex: 1 }}><strong style={{ fontWeight: 500, fontSize: 13 }}>{l.name}</strong><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{l.fulfilment}</span></span>
                    {l.id === "marina" ? <Badge tone="warning" icon="alert-triangle">Out of stock</Badge> : null}
                    <Switch label="Available" checked={l.id !== "marina"} onChange={() => setDirty(true)} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          {tab === "variants" ? <EmptyState icon="layers" title="Variants are managed under Pricing" body="Size and price variants for this product live on the Details tab so price and option stay together." actions={<Button variant="secondary" onClick={() => setTab("details")}>Go to Details</Button>} /> : null}
          {tab === "media" ? <EmptyState icon="image" title="No images yet" body="Products without an image convert 23% worse on the Online Store." actions={<Button icon="upload">Upload image</Button>} /> : null}
          {tab === "channels" ? (
            <Card header="Channel visibility">
              <div style={{ display: "grid", gap: 12 }}>
                {window.CHANNELS.slice(0, 4).map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Icon name={c.icon} size={15} style={{ color: "var(--text-tertiary)" }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
                    <Checkbox checked={c.id !== "talabat"} onChange={() => setDirty(true)} label="Visible" />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <Card header="Status" padding="sm">
            <div style={{ display: "grid", gap: 10 }}>
              <Select id="pstate" label="Publishing state" options={["Draft", "Published", "Archived"]} defaultValue="Published" onChange={() => setDirty(true)} />
              <Switch label="Available for delivery" checked={delivery} onChange={() => { setDelivery(!delivery); setDirty(true); }} />
              <Switch label="Available for collection" checked onChange={() => setDirty(true)} />
            </div>
          </Card>
          <Card tone="intelligence" padding="sm">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><AiBadge>AI suggestion</AiBadge></div>
            <p style={{ fontSize: 13, lineHeight: "19px", color: "var(--text-secondary)", margin: 0 }}>
              Similar products at Marina Walk use a 5% delivery uplift. Applying it here would add AED 0.90 to the regular size.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button size="sm" variant="intelligence">Review change</Button>
              <Button size="sm" variant="ghost">Dismiss</Button>
            </div>
          </Card>
          <Card header="Applied to" padding="sm">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Tag>Main menu</Tag><Tag>Delivery menu</Tag><Tag>Coffee</Tag>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { CatalogueScreen });

}

/* ---- ChannelsScreen.jsx ---- */
{
const { PageHeader, Card, Button, StatusBadge, Badge, Tabs, Breadcrumbs, Icon, IconButton, Input, Select, Switch, SegmentedControl, DataTable, Timeline, Alert, Banner, Toast, ToastStack, ConfirmDialog, Drawer, Chip, Logo, ProgressBar, Tag } = window.QOSDesignSystem_913581;

/* Flow 3 — configure the Online Store. Flow 7 — publishing history and rollback. */
function ChannelsScreen() {
  const [channel, setChannel] = React.useState(null);
  if (channel === "store") return <OnlineStore onBack={() => setChannel(null)} />;
  return (
    <>
      <PageHeader
        title="Sales Channels"
        subtitle="Every channel consumes the same catalogue and location configuration from QOS."
        actions={<Button icon="plus">Add channel</Button>}
        tabs={<Tabs tabs={[{ id: "connected", label: "Connected", count: 4 }, { id: "available", label: "Available", count: 2 }]} value="connected" onChange={() => {}} />}
      />
      <window.Grid cols={3} style={{ marginTop: 20 }}>
        {window.CHANNELS.map((c) => (
          <Card key={c.id} padding="none" interactive={c.id === "store"} onClick={c.id === "store" ? () => setChannel("store") : undefined}>
            <div style={{ padding: "var(--card-padding)", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", display: "grid", placeItems: "center", color: "var(--text-secondary)", flex: "none" }}><Icon name={c.icon} size={17} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</strong>
                  <StatusBadge state={c.state} />
                </span>
                <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{c.kind}</span>
              </span>
            </div>
            <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px var(--card-padding)", display: "grid", gap: 7, fontSize: 12 }}>
              <Row label="Locations" value={c.locations} />
              <Row label="Catalogue" value={c.catalogue} />
              <Row label="Sync health" value={<StatusBadge state={c.sync} />} />
            </div>
            <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px var(--card-padding)", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
              <Icon name="history" size={13} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.activity}</span>
              {c.state === "available" ? <Button size="sm" variant="secondary">Connect</Button> : <Icon name="chevron-right" size={14} />}
            </div>
          </Card>
        ))}
      </window.Grid>
    </>
  );
}

function Row({ label, value }) {
  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </span>
  );
}

function OnlineStore({ onBack }) {
  const [tab, setTab] = React.useState("overview");
  const [device, setDevice] = React.useState("Desktop");
  const [dirty, setDirty] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [confirm, setConfirm] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [release, setRelease] = React.useState(null);
  const [activeRelease, setActiveRelease] = React.useState(42);

  return (
    <>
      {dirty ? (
        <div style={{ margin: "-24px calc(-1 * var(--layout-gutter)) 20px" }}>
          <Banner tone="warning" icon="circle-dot" actions={<><Button size="sm" variant="ghost" onClick={() => setDirty(false)}>Discard draft</Button><Button size="sm" icon="upload-cloud" onClick={() => setConfirm("publish")}>Publish</Button></>}>
            Draft has unpublished changes. Customers still see <strong>Release {activeRelease}</strong>.
          </Banner>
        </div>
      ) : null}
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ id: "channels", label: "Sales Channels" }, { label: "Online Store" }]} onNavigate={onBack} />}
        title="Online Store"
        badge={<StatusBadge state="live" />}
        subtitle="Shared QOS Storefront renderer · quotes.qosapp.com"
        meta={<>
          <span><Icon name="globe" size={12} /> quotes.qosapp.com</span>
          <span><Icon name="history" size={12} /> Release {activeRelease} published 4h ago</span>
          <span><Icon name="map-pin" size={12} /> 12 of 12 locations</span>
          <span><Icon name="package" size={12} /> Main menu</span>
        </>}
        actions={<><Button variant="secondary" icon="external-link">View store</Button><Button icon="upload-cloud" onClick={() => setConfirm("publish")}>Publish</Button></>}
        tabs={<Tabs
          tabs={[{ id: "overview", label: "Overview" }, { id: "appearance", label: "Appearance" }, { id: "pages", label: "Pages", count: 7 }, { id: "menus", label: "Menus" }, { id: "branches", label: "Branches & fulfilment" }, { id: "domains", label: "Domains" }, { id: "payments", label: "Payments" }, { id: "history", label: "Publishing history" }]}
          value={tab} onChange={setTab} />}
      />

      <div style={{ marginTop: 20 }}>
        {tab === "overview" ? (
          <window.Grid cols={3} style={{ alignItems: "start" }}>
            <Card header="Store health" style={{ gridColumn: "span 2" }} padding="none">
              <div style={{ padding: "var(--card-padding)", display: "grid", gap: 12, fontSize: 13 }}>
                <Row label="Status" value={<StatusBadge state="live" />} />
                <Row label="Primary domain" value="quotes.qosapp.com" />
                <Row label="Domain verification" value={<StatusBadge state="verified" />} />
                <Row label="Payments" value={<StatusBadge state="connected" label="Stripe connected" />} />
                <Row label="Catalogue sync" value={<StatusBadge state="synced" />} />
                <Row label="Active release" value={`Release ${activeRelease} · 12 Sep, 09:14`} />
              </div>
            </Card>
            <div style={{ display: "grid", gap: 16 }}>
              <Alert tone="info" title="Publishing creates a release">Draft edits never touch the live store. Publishing produces an immutable release you can roll back to.</Alert>
              <Card header="Recent changes" padding="sm">
                <Timeline items={window.RELEASES.slice(0, 3).map((r) => ({ title: r.version, meta: `${r.date} · ${r.user}`, tone: r.state === "failed" ? "error" : "success", icon: r.state === "failed" ? "x-circle" : "upload-cloud" }))} />
              </Card>
            </div>
          </window.Grid>
        ) : null}

        {tab === "appearance" ? (
          <window.Grid cols={2} style={{ alignItems: "start" }}>
            <Card header="Brand & theme" subtitle="Applied to the shared storefront renderer for this tenant only.">
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <div className="qos-field-label" style={{ marginBottom: 8 }}>Logo</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, border: "1px dashed var(--border-default)", borderRadius: "var(--radius-card)" }}>
                    <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.02em" }}>Quotes</span>
                    <Button size="sm" variant="secondary" icon="upload" onClick={() => setDirty(true)}>Replace</Button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Input id="brandcol" label="Brand colour" defaultValue="#1B4332" leadingIcon="palette" onChange={() => setDirty(true)} />
                  <Select id="brandfont" label="Typeface" options={["Inter", "Source Serif", "Space Grotesk"]} onChange={() => setDirty(true)} />
                </div>
                <Select id="theme" label="Theme preset" options={["Classic", "Editorial", "Compact"]} onChange={() => setDirty(true)} />
                <Switch label="Show opening hours in header" checked onChange={() => setDirty(true)} />
                <Switch label="Show location picker on first visit" onChange={() => setDirty(true)} />
              </div>
            </Card>
            <Card
              header="Preview"
              subtitle={dirty ? "Draft — not yet published" : `Release ${activeRelease} — live`}
              actions={<SegmentedControl options={[{ value: "Desktop", label: "Desktop", icon: "monitor" }, { value: "Mobile", label: "Mobile", icon: "smartphone" }]} value={device} onChange={setDevice} />}
            >
              <StorePreview device={device} draft={dirty} />
            </Card>
          </window.Grid>
        ) : null}

        {tab === "pages" ? (
          <window.Grid cols={2} style={{ alignItems: "start" }}>
            <Card header="Homepage blocks" subtitle="Reusable blocks only — the storefront is a renderer, not a website builder." actions={<Button size="sm" variant="secondary" icon="plus">Add block</Button>} padding="none">
              <div style={{ padding: 12, display: "grid", gap: 8 }}>
                {window.BLOCKS.map((b) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", background: "var(--surface-default)" }}>
                    <Icon name="grip-vertical" size={14} style={{ color: "var(--text-tertiary)", cursor: "grab" }} />
                    <Icon name={b.icon} size={15} style={{ color: "var(--text-secondary)" }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13, fontWeight: 500 }}>{b.name}</strong>
                      <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{b.note}</span>
                    </span>
                    {b.state === "draft" ? <StatusBadge state="draft" /> : null}
                    <Switch checked={b.id !== "featured"} onChange={() => setDirty(true)} />
                    <IconButton icon="settings-2" label={`Configure ${b.name}`} size="sm" onClick={() => setDirty(true)} />
                  </div>
                ))}
              </div>
            </Card>
            <Card header="Preview" subtitle={dirty ? "Draft — not yet published" : `Release ${activeRelease} — live`} actions={<SegmentedControl options={[{ value: "Desktop", label: "Desktop", icon: "monitor" }, { value: "Mobile", label: "Mobile", icon: "smartphone" }]} value={device} onChange={setDevice} />}>
              <StorePreview device={device} draft={dirty} />
            </Card>
          </window.Grid>
        ) : null}

        {tab === "history" ? (
          <Card padding="none" header="Publishing history" subtitle="Every publish produces an immutable release. Rollback re-activates a previous release without a deployment.">
            <DataTable
              columns={[
                { key: "version", header: "Version", render: (r) => <span style={{ fontWeight: 500 }}>{r.version}{r.id === activeRelease ? <Badge tone="success" style={{ marginLeft: 8 }}>Active</Badge> : null}</span> },
                { key: "date", header: "Published" },
                { key: "user", header: "By" },
                { key: "changes", header: "Changes" },
                { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} /> },
                { key: "act", header: "", width: 190, render: (r) => (
                  <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setRelease(r); }}>Inspect</Button>
                    {r.id !== activeRelease && r.state === "published" ? <Button size="sm" variant="secondary" icon="rotate-ccw" onClick={(e) => { e.stopPropagation(); setConfirm(r); }}>Roll back</Button> : null}
                  </span>
                ) },
              ]}
              rows={window.RELEASES}
              rowKey="id"
            />
          </Card>
        ) : null}

        {["menus", "branches", "domains", "payments"].includes(tab) ? (
          <window.Grid cols={2} style={{ alignItems: "start" }}>
            <Card header={{ menus: "Menu assignment", branches: "Branches & fulfilment", domains: "Domains", payments: "Payments" }[tab]}>
              {tab === "menus" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <Select id="m1" label="Default menu" options={["Main menu", "Delivery menu", "Breakfast menu"]} onChange={() => setDirty(true)} />
                  <Row label="Sections" value="6" />
                  <Row label="Items" value="84" />
                  <Row label="Last synced" value="20 minutes ago" />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Tag>Main menu</Tag><Tag>en-AE</Tag><Tag>ar-AE</Tag></div>
                </div>
              ) : null}
              {tab === "branches" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {window.LOCATIONS.map((l) => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                      <span style={{ flex: 1 }}><strong style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</strong><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{l.fulfilment}</span></span>
                      <Switch label="Exposed" checked={l.state !== "paused"} onChange={() => setDirty(true)} />
                    </div>
                  ))}
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>Locations are never exposed automatically — each one is explicitly allowed on this storefront.</p>
                </div>
              ) : null}
              {tab === "domains" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="globe" size={15} /><span style={{ flex: 1, fontSize: 13 }}>quotes.qosapp.com</span><Badge tone="neutral">Platform subdomain</Badge><StatusBadge state="verified" /></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="globe" size={15} /><span style={{ flex: 1, fontSize: 13 }}>order.quotes.ae</span><Badge tone="neutral">Custom domain</Badge><StatusBadge state="pending" label="Verifying" /></div>
                  <Alert tone="info" title="Add a CNAME record">Point <code>order.quotes.ae</code> at <code>qos-dev-storefront.azurefd.net</code>, then verify.</Alert>
                  <Button variant="secondary" icon="plus" style={{ justifySelf: "start" }}>Add domain</Button>
                </div>
              ) : null}
              {tab === "payments" ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <Row label="Provider" value="Stripe" />
                  <Row label="Status" value={<StatusBadge state="connected" />} />
                  <Row label="Methods" value="Card, Apple Pay, Google Pay" />
                  <Row label="Payouts" value="Daily · AED" />
                  <Alert tone="warning" title="Changing the provider affects live checkout">Customers mid-checkout may see an error for up to 30 seconds.</Alert>
                </div>
              ) : null}
            </Card>
            <Card header="Preview" subtitle={dirty ? "Draft — not yet published" : `Release ${activeRelease} — live`} actions={<SegmentedControl options={[{ value: "Desktop", label: "Desktop", icon: "monitor" }, { value: "Mobile", label: "Mobile", icon: "smartphone" }]} value={device} onChange={setDevice} />}>
              <StorePreview device={device} draft={dirty} />
            </Card>
          </window.Grid>
        ) : null}
      </div>

      {release ? (
        <Drawer title={release.version} description={`${release.date} · ${release.user}`} onClose={() => setRelease(null)}
          footer={<><Button variant="ghost" onClick={() => setRelease(null)}>Close</Button>{release.id !== activeRelease && release.state === "published" ? <Button icon="rotate-ccw" onClick={() => { setConfirm(release); setRelease(null); }}>Roll back to this release</Button> : null}</>}>
          <window.DefinitionList items={[
            { label: "Release", value: release.version },
            { label: "Status", value: <StatusBadge state={release.state} /> },
            { label: "Published", value: release.date },
            { label: "By", value: release.user },
            { label: "Changes", value: release.changes },
            { label: "Menu", value: "Main menu · 84 items" },
            { label: "Locations", value: "12 exposed" },
            { label: "Snapshot", value: <code>rel_{release.id}_8f31c9</code> },
          ]} />
          <div style={{ marginTop: 20 }}>
            <StorePreview device="Desktop" draft={false} />
          </div>
        </Drawer>
      ) : null}

      {confirm === "publish" ? (
        <ConfirmDialog
          title="Publish draft to quotes.qosapp.com?"
          description="A new immutable release is created and served to customers immediately. The previous release stays available for rollback."
          confirmLabel="Publish release 43"
          onClose={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); setPublishing(true); setTimeout(() => { setPublishing(false); setDirty(false); setActiveRelease(43); setToast("Release 43 is live on quotes.qosapp.com"); }, 1400); }}
        >
          <window.DefinitionList items={[
            { label: "Channel", value: "Online Store" },
            { label: "Domain", value: "quotes.qosapp.com" },
            { label: "Changes", value: "Homepage blocks, theme colour" },
            { label: "Locations affected", value: "12" },
          ]} />
        </ConfirmDialog>
      ) : null}

      {confirm && confirm !== "publish" ? (
        <ConfirmDialog
          tone="danger"
          title={`Roll back to ${confirm.version}?`}
          description={`Release ${activeRelease} will stop being served. Customers will see ${confirm.version} within a few seconds. Nothing is deleted.`}
          confirmLabel={`Roll back to ${confirm.version}`}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const v = confirm; setConfirm(null); setActiveRelease(v.id); setToast(`${v.version} is now active on quotes.qosapp.com`); }}
        >
          <window.DefinitionList items={[
            { label: "Currently live", value: `Release ${activeRelease}` },
            { label: "Rolling back to", value: `${confirm.version} · ${confirm.date}` },
            { label: "Difference", value: confirm.changes },
          ]} />
        </ConfirmDialog>
      ) : null}

      {publishing ? (
        <div className="qos-scrim">
          <div className="qos-modal" data-size="sm" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Logo variant="light" height={16} assetBase="assets/" />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Publishing release 43</span>
            </div>
            <ProgressBar tone="intelligence" indeterminate label="Validating draft, snapshotting catalogue, activating release" />
          </div>
        </div>
      ) : null}
      {toast ? <ToastStack><Toast tone="success" title="Published" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

/* A deliberately schematic representation of the customer-facing storefront.
   The real storefront runtime is a separate application and was not supplied. */
function StorePreview({ device, draft }) {
  const w = device === "Mobile" ? 260 : "100%";
  return (
    <div style={{ background: "var(--surface-sunken)", borderRadius: "var(--radius-card)", padding: 16, display: "grid", placeItems: "center" }}>
      <div style={{ width: w, maxWidth: "100%", background: "#fff", borderRadius: 10, border: "1px solid var(--border-default)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ height: 26, background: "var(--navy-100)", display: "flex", alignItems: "center", gap: 5, padding: "0 8px" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--navy-300)" }} />
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--navy-300)" }} />
          <span style={{ flex: 1, height: 12, borderRadius: 999, background: "#fff", fontSize: 7, color: "var(--text-tertiary)", display: "grid", placeItems: "center" }}>quotes.qosapp.com</span>
        </div>
        <div style={{ padding: device === "Mobile" ? 10 : 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1B4332" }}>Quotes</span>
            <span style={{ display: "flex", gap: 6 }}>{["Menu", "Locations", "Order"].map((t) => <span key={t} style={{ fontSize: 7, color: "#4b5563" }}>{t}</span>)}</span>
          </div>
          <div style={{ height: device === "Mobile" ? 70 : 96, borderRadius: 6, background: draft ? "linear-gradient(120deg,#1B4332,#2d6a4f)" : "linear-gradient(120deg,#22303c,#3c4f5c)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 10, color: "#fff" }}>
            <span style={{ fontSize: device === "Mobile" ? 10 : 13, fontWeight: 600 }}>Coffee, all day.</span>
            <span style={{ fontSize: 7, opacity: .85 }}>Order for collection or delivery</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: device === "Mobile" ? "1fr 1fr" : "repeat(4,1fr)", gap: 6, marginTop: 10 }}>
            {["Coffee", "Tea", "Bakery", "Kitchen"].map((c) => (
              <div key={c} style={{ border: "1px solid #e5e7eb", borderRadius: 5, padding: "8px 6px", fontSize: 7, color: "#374151", textAlign: "center" }}>{c}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: device === "Mobile" ? "1fr 1fr" : "repeat(4,1fr)", gap: 6, marginTop: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 5, overflow: "hidden" }}>
                <div style={{ height: 30, background: "#f3f4f6" }} />
                <div style={{ padding: 5, fontSize: 7, color: "#374151" }}>Flat white<br /><span style={{ color: "#6b7280" }}>AED 21.00</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
        {draft ? <><span className="qos-badge" data-tone="neutral">Draft</span> Not visible to customers</> : <><span className="qos-badge" data-tone="success">Published</span> Live for customers</>}
      </div>
    </div>
  );
}

Object.assign(window, { ChannelsScreen });

}

/* ---- LocationsScreen.jsx ---- */
{
const { PageHeader, Card, Button, DataTable, StatusBadge, Badge, Tabs, Breadcrumbs, Icon, Input, Select, Switch, Checkbox, Banner, Toast, ToastStack, Alert, TableToolbar, SearchInput, Chip } = window.QOSDesignSystem_913581;

/* Flow 4 — locations → location → hours / fulfilment → catalogue availability → save. */
function LocationsScreen() {
  const [loc, setLoc] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  if (loc) return <LocationDetail location={loc} onBack={() => setLoc(null)} onSaved={(m) => { setLoc(null); setToast(m); }} />;
  return (
    <>
      <PageHeader
        title="Locations"
        subtitle="Branches are the unit of operational control: hours, fulfilment, availability and integrations all resolve per location."
        actions={<Button icon="plus">Add location</Button>}
      />
      <div style={{ marginTop: 20 }}>
        <Card padding="none">
          <TableToolbar>
            <SearchInput placeholder="Search locations" style={{ width: 220 }} />
            <Chip icon="alert-triangle" count={1}>Needs attention</Chip>
            <Chip>All channels</Chip>
            <Chip>Open now</Chip>
          </TableToolbar>
          <DataTable
            columns={[
              { key: "name", header: "Branch", sortable: true, render: (r) => <span><strong style={{ fontWeight: 500 }}>{r.name}</strong><span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{r.city}</span></span> },
              { key: "state", header: "Operational status", render: (r) => <StatusBadge state={r.state} label={r.state === "warning" ? "Degraded" : undefined} /> },
              { key: "hours", header: "Opening state", render: (r) => <span style={{ fontSize: 12, color: r.state === "paused" ? "var(--text-secondary)" : "var(--text-primary)" }}>{r.hours}</span> },
              { key: "channels", header: "Channels", render: (r) => <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.channels}</span> },
              { key: "fulfilment", header: "Fulfilment", render: (r) => <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.fulfilment}</span> },
              { key: "integration", header: "Integration health", render: (r) => <StatusBadge state={r.integration} /> },
            ]}
            rows={window.LOCATIONS}
            onRowClick={setLoc}
            sortKey="name"
          />
        </Card>
      </div>
      {toast ? <ToastStack><Toast tone="success" title="Saved" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function LocationDetail({ location, onBack, onSaved }) {
  const [tab, setTab] = React.useState("hours");
  const [dirty, setDirty] = React.useState(false);
  return (
    <>
      {dirty ? (
        <div style={{ margin: "-24px calc(-1 * var(--layout-gutter)) 20px" }}>
          <Banner tone="warning" icon="circle-dot" actions={<><Button size="sm" variant="ghost" onClick={() => setDirty(false)}>Discard</Button><Button size="sm" icon="check" onClick={() => onSaved(`${location.name} updated · hours and fulfilment are live`)}>Save changes</Button></>}>
            Unsaved changes to <strong>{location.name}</strong>. Hours and fulfilment apply to every channel immediately once saved.
          </Banner>
        </div>
      ) : null}
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ id: "locations", label: "Locations" }, { label: location.name }]} onNavigate={onBack} />}
        title={location.name}
        badge={<StatusBadge state={location.state} label={location.state === "warning" ? "Degraded" : undefined} />}
        subtitle={location.city}
        meta={<>
          <span><Icon name="clock" size={12} /> {location.hours}</span>
          <span><Icon name="truck" size={12} /> {location.fulfilment}</span>
          <span><Icon name="store" size={12} /> {location.channels}</span>
        </>}
        actions={<><Button variant="secondary" icon="pause">Pause orders</Button><Button icon="check" onClick={() => onSaved(`${location.name} updated`)}>Save</Button></>}
        tabs={<Tabs tabs={[{ id: "details", label: "Details" }, { id: "hours", label: "Hours" }, { id: "fulfilment", label: "Fulfilment" }, { id: "availability", label: "Catalogue availability" }, { id: "channels", label: "Channels" }, { id: "integrations", label: "Integrations", tone: location.integration === "error" ? "error" : undefined }, { id: "orders", label: "Orders" }]} value={tab} onChange={setTab} />}
      />
      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          {tab === "hours" ? (
            <Card header="Opening hours" subtitle="Used by every channel to decide whether this branch can accept orders.">
              <div style={{ display: "grid", gap: 10 }}>
                {DAYS.map((d) => (
                  <div key={d} style={{ display: "grid", gridTemplateColumns: "120px 110px 110px 1fr", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{d}</span>
                    <Input id={`o${d}`} defaultValue="07:00" onChange={() => setDirty(true)} />
                    <Input id={`c${d}`} defaultValue={d === "Friday" || d === "Saturday" ? "00:00" : "23:00"} onChange={() => setDirty(true)} />
                    <Switch label="Open" checked onChange={() => setDirty(true)} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          {tab === "fulfilment" ? (
            <Card header="Fulfilment" subtitle="What this branch can do, and how far it will go.">
              <div style={{ display: "grid", gap: 16, maxWidth: "var(--layout-form-max)" }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <Checkbox label="Delivery" description="Own drivers and marketplace couriers" checked onChange={() => setDirty(true)} />
                  <Checkbox label="Collection" description="Customer collects in store" checked onChange={() => setDirty(true)} />
                  <Checkbox label="Dine-in" description="Table ordering through POS" checked onChange={() => setDirty(true)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Input id="radius" label="Delivery radius (km)" defaultValue="6" onChange={() => setDirty(true)} />
                  <Input id="prep" label="Preparation time (min)" defaultValue="18" onChange={() => setDirty(true)} />
                  <Input id="minorder" label="Minimum order (AED)" defaultValue="25.00" onChange={() => setDirty(true)} />
                  <Select id="slots" label="Scheduling" options={["ASAP only", "ASAP and scheduled", "Scheduled only"]} onChange={() => setDirty(true)} />
                </div>
              </div>
            </Card>
          ) : null}
          {tab === "availability" ? (
            <Card header="Catalogue availability" subtitle="Stop-sale at this branch without touching the published catalogue." padding="none">
              <DataTable
                density="dense"
                columns={[
                  { key: "name", header: "Product" },
                  { key: "category", header: "Category" },
                  { key: "price", header: "Price (AED)", numeric: true },
                  { key: "av", header: "Available here", render: (r) => <Switch checked={!(r.exception)} onChange={() => setDirty(true)} /> },
                  { key: "state", header: "Catalogue status", render: (r) => <StatusBadge state={r.state} /> },
                ]}
                rows={window.PRODUCTS}
              />
            </Card>
          ) : null}
          {tab === "details" ? (
            <Card header="Branch details">
              <div style={{ display: "grid", gap: 16, maxWidth: "var(--layout-form-max)" }}>
                <Input id="lname" label="Branch name" defaultValue={location.name} onChange={() => setDirty(true)} />
                <Input id="laddr" label="Address" defaultValue={location.city} onChange={() => setDirty(true)} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Input id="lphone" label="Phone" defaultValue="+971 4 555 0142" onChange={() => setDirty(true)} />
                  <Select id="ltz" label="Timezone" options={["Asia/Dubai", "Asia/Riyadh"]} onChange={() => setDirty(true)} />
                </div>
              </div>
            </Card>
          ) : null}
          {tab === "integrations" ? (
            <div style={{ display: "grid", gap: 16 }}>
              {location.integration === "error" ? <Alert tone="error" title="Lightspeed is failing for this branch" actions={<Button size="sm" variant="secondary">Open integration</Button>}>9 orders have not reached the POS since 14:02.</Alert> : null}
              <Card header="Connected at this branch" padding="none">
                {window.INTEGRATIONS.slice(0, 4).map((i) => (
                  <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px var(--card-padding)", borderBottom: "1px solid var(--border-subtle)" }}>
                    <Icon name={i.icon} size={15} style={{ color: "var(--text-secondary)" }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{i.name}<span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{i.kind} · {i.health}</span></span>
                    <StatusBadge state={i.state} />
                  </div>
                ))}
              </Card>
            </div>
          ) : null}
          {tab === "channels" ? (
            <Card header="Channels exposing this branch">
              <div style={{ display: "grid", gap: 12 }}>
                {window.CHANNELS.slice(0, 4).map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Icon name={c.icon} size={15} style={{ color: "var(--text-tertiary)" }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
                    <Switch label="Exposed" checked={c.id !== "talabat"} onChange={() => setDirty(true)} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          {tab === "orders" ? (
            <Card header="Recent orders at this branch" padding="none">
              <DataTable
                density="dense"
                columns={[
                  { key: "id", header: "Order", render: (r) => <span style={{ fontFamily: "var(--font-mono)" }}>{r.id}</span> },
                  { key: "customer", header: "Customer" },
                  { key: "channel", header: "Channel" },
                  { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} /> },
                  { key: "amount", header: "Amount", numeric: true },
                  { key: "time", header: "Time", numeric: true },
                ]}
                rows={window.ORDERS.filter((o) => o.location === location.name)}
              />
            </Card>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <Card header="Today" padding="sm">
            <div style={{ display: "grid", gap: 9, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-secondary)" }}>Orders</span><strong>142</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-secondary)" }}>Revenue</span><strong>5,480 AED</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-secondary)" }}>Exceptions</span><strong style={{ color: "var(--status-error-fg)" }}>2</strong></div>
            </div>
          </Card>
          <Card header="Live controls" subtitle="Take effect immediately" padding="sm">
            <div style={{ display: "grid", gap: 10 }}>
              <Switch label="Accepting orders" checked onChange={() => setDirty(true)} />
              <Switch label="Delivery enabled" checked onChange={() => setDirty(true)} />
              <Switch label="Busy mode (+10 min)" onChange={() => setDirty(true)} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { LocationsScreen });

}

/* ---- IntegrationsScreen.jsx ---- */
{
const { PageHeader, Card, Button, StatusBadge, Badge, Tabs, Breadcrumbs, Icon, Input, Select, Switch, Stepper, Alert, Modal, Toast, ToastStack, DataTable, Timeline, Chip, SearchInput, ProgressBar, AiBadge, EmptyState } = window.QOSDesignSystem_913581;

/* Flow 5 — integrations → provider → connect → configure → map locations → connected. */
function IntegrationsScreen() {
  const [detail, setDetail] = React.useState(null);
  const [wizard, setWizard] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [connected, setConnected] = React.useState([]);

  if (detail) return <IntegrationDetail integration={detail} onBack={() => setDetail(null)} onToast={setToast} toast={toast} />;

  return (
    <>
      <PageHeader
        title="Integration Centre"
        subtitle="QOS is POS-agnostic. Every integration is configured once and mapped to the locations that use it."
        actions={<Button variant="secondary" icon="book-open">Developer docs</Button>}
        tabs={<Tabs tabs={[{ id: "all", label: "All", count: 8 }, { id: "connected", label: "Connected", count: 4 }, { id: "attention", label: "Needs attention", count: 2, tone: "warning" }, { id: "available", label: "Available", count: 4 }]} value="all" onChange={() => {}} />}
      />
      <div style={{ marginTop: 20 }}>
        <Alert tone="error" title="Lightspeed POS is returning errors" actions={<Button size="sm" variant="secondary" onClick={() => setDetail(window.INTEGRATIONS[0])}>Open integration</Button>}>
          9 order pushes failed in the last hour across 12 locations. Orders are being held in QOS, not lost.
        </Alert>
      </div>
      <window.Grid cols={4} style={{ marginTop: 20 }}>
        {window.INTEGRATIONS.map((i) => {
          const state = connected.includes(i.id) ? "connected" : i.state;
          return (
            <Card key={i.id} padding="none" interactive onClick={() => (state === "available" ? setWizard(i) : setDetail({ ...i, state }))}>
              <div style={{ padding: "var(--card-padding)", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", display: "grid", placeItems: "center", color: "var(--text-secondary)", flex: "none" }}><Icon name={i.icon} size={17} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14, fontWeight: 600 }}>{i.name}</strong>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{i.kind}</span>
                </span>
              </div>
              <div style={{ padding: "0 var(--card-padding) 12px" }}>
                <StatusBadge state={state} />
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0 0", lineHeight: "17px" }}>{connected.includes(i.id) ? "Healthy · connected just now" : i.health}</p>
              </div>
              <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "9px var(--card-padding)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)" }}>
                <span>{connected.includes(i.id) ? "12 mapped" : i.locations}</span>
                {state === "available" ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setWizard(i); }}>Connect</Button> : <Icon name="chevron-right" size={14} />}
              </div>
            </Card>
          );
        })}
      </window.Grid>
      {wizard ? <ConnectWizard integration={wizard} onClose={() => setWizard(null)} onDone={() => { setConnected((c) => [...c, wizard.id]); setToast(`${wizard.name} connected · 12 locations mapped`); setWizard(null); }} /> : null}
      {toast ? <ToastStack><Toast tone="success" title="Connected" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

function ConnectWizard({ integration, onClose, onDone }) {
  const [step, setStep] = React.useState(0);
  const steps = ["Connect", "Configure", "Map locations", "Verify"];
  const next = () => (step < 3 ? setStep(step + 1) : onDone());
  return (
    <Modal
      open
      size="lg"
      title={`Connect ${integration.name}`}
      description={`${integration.kind} · configuration applies to every location you map`}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {step > 0 ? <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button> : null}
        <Button icon={step === 3 ? "check" : undefined} iconTrailing={step === 3 ? undefined : "arrow-right"} onClick={next}>
          {step === 3 ? "Finish and activate" : "Continue"}
        </Button>
      </>}
    >
      <div style={{ marginBottom: 20 }}><Stepper steps={steps} current={step} /></div>
      {step === 0 ? (
        <div style={{ display: "grid", gap: 14 }}>
          <Alert tone="info" title="You will be redirected to {integration.name}">QOS never stores your provider password. Access is granted through an authorised connection.</Alert>
          <Input id="acct" label="Account or merchant ID" placeholder="e.g. QTS-AE-0142" />
          <Select id="env" label="Environment" options={["Production", "Sandbox"]} />
        </div>
      ) : null}
      {step === 1 ? (
        <div style={{ display: "grid", gap: 14 }}>
          <Select id="dir" label="Sync direction" options={["QOS is the source of truth", "Provider is the source of truth", "Two-way"]} />
          <Select id="freq" label="Catalogue sync frequency" options={["Every 15 minutes", "Hourly", "Manual only"]} />
          <Switch label="Push orders automatically" checked />
          <Switch label="Hold orders when the provider is unhealthy" checked description="Orders stay in QOS and are replayed instead of failing." />
        </div>
      ) : null}
      {step === 2 ? (
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Map each QOS location to a provider site. Unmapped locations will not sync.</p>
          <Card tone="intelligence" padding="sm">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><AiBadge>AI mapping</AiBadge><span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Suggested from names and addresses — review before applying</span></div>
            <p style={{ fontSize: 13, margin: 0, color: "var(--text-secondary)" }}>4 of 4 locations matched with high confidence.</p>
          </Card>
          {window.LOCATIONS.map((l) => (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</span>
              <Icon name="arrow-right" size={14} style={{ color: "var(--text-tertiary)", justifySelf: "center" }} />
              <Select id={`map${l.id}`} options={[`${l.name} (site ${l.id.toUpperCase()})`, "Not mapped"]} />
            </div>
          ))}
        </div>
      ) : null}
      {step === 3 ? (
        <div style={{ display: "grid", gap: 14 }}>
          <ProgressBar label="Verifying connection" value={100} />
          <Timeline items={[
            { title: "Credentials accepted", meta: "Provider responded in 240ms", tone: "success", icon: "check" },
            { title: "4 locations mapped", meta: "No unmapped locations remain", tone: "success", icon: "map-pin" },
            { title: "Catalogue test sync", meta: "84 items · 0 errors", tone: "success", icon: "refresh-cw" },
            { title: "Ready to activate", meta: "Orders will start flowing once you finish", tone: "processing", icon: "clock" },
          ]} />
        </div>
      ) : null}
    </Modal>
  );
}

function IntegrationDetail({ integration, onBack, onToast, toast }) {
  const [tab, setTab] = React.useState(integration.state === "error" ? "health" : "connection");
  return (
    <>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ id: "integrations", label: "Integrations" }, { label: integration.name }]} onNavigate={onBack} />}
        title={integration.name}
        badge={<StatusBadge state={integration.state} />}
        subtitle={`${integration.kind} · ${integration.locations}`}
        actions={<>
          <Button variant="secondary" icon="file-text">Download logs</Button>
          {integration.state === "error" ? <Button icon="refresh-cw" onClick={() => onToast(`${integration.name} reconnected`)}>Reconnect</Button> : <Button variant="secondary" icon="unplug">Disconnect</Button>}
        </>}
        tabs={<Tabs tabs={[{ id: "connection", label: "Connection" }, { id: "config", label: "Configuration" }, { id: "mapping", label: "Mapping" }, { id: "locations", label: "Locations", count: 12 }, { id: "health", label: "Sync health", tone: integration.state === "error" ? "error" : undefined }, { id: "logs", label: "Activity & logs" }]} value={tab} onChange={setTab} />}
      />
      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 20, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          {integration.state === "error" ? (
            <Alert tone="error" title="Connector unhealthy since 14:02" actions={<><Button size="sm" icon="refresh-cw" onClick={() => onToast(`${integration.name} reconnected`)}>Reconnect</Button><Button size="sm" variant="secondary">Replay 9 held orders</Button></>}>
              The provider is returning <code>502 Bad Gateway</code>. QOS is holding orders rather than dropping them.
            </Alert>
          ) : null}
          {tab === "health" ? (
            <Card header="Sync health" subtitle="Last 24 hours">
              <window.Grid cols={3} gap={12} style={{ marginBottom: 16 }}>
                <div><div className="qos-kpi-label">Successful calls</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>4,812</div></div>
                <div><div className="qos-kpi-label">Failed calls</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px", color: "var(--status-error-fg)" }}>9</div></div>
                <div><div className="qos-kpi-label">Median latency</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>240<span style={{ fontSize: 14, color: "var(--text-secondary)" }}>ms</span></div></div>
              </window.Grid>
              <Timeline items={[
                { title: "Connector degraded", meta: "14:02 · 502 Bad Gateway", tone: "error", icon: "alert-circle" },
                { title: "9 orders held for replay", meta: "14:02 – 14:07 · Marina Walk, Downtown", tone: "warning", icon: "pause" },
                { title: "Catalogue sync completed", meta: "13:45 · 84 items", tone: "success", icon: "refresh-cw" },
              ]} />
            </Card>
          ) : null}
          {tab === "connection" ? (
            <Card header="Connection">
              <div style={{ display: "grid", gap: 16, maxWidth: "var(--layout-form-max)" }}>
                <window.DefinitionList items={[
                  { label: "Provider", value: integration.name },
                  { label: "Account", value: "QTS-AE-0142" },
                  { label: "Environment", value: "Production" },
                  { label: "Connected", value: "02 Aug 2026 · Jamie Doyle" },
                  { label: "Credential", value: <span style={{ display: "flex", alignItems: "center", gap: 8 }}><code>••••••••••8f31</code><Button size="sm" variant="ghost">Rotate</Button></span> },
                ]} />
              </div>
            </Card>
          ) : null}
          {tab === "config" ? (
            <Card header="Configuration">
              <div style={{ display: "grid", gap: 14, maxWidth: "var(--layout-form-max)" }}>
                <Select id="dir2" label="Sync direction" options={["QOS is the source of truth", "Provider is the source of truth", "Two-way"]} />
                <Select id="freq2" label="Catalogue sync frequency" options={["Every 15 minutes", "Hourly", "Manual only"]} />
                <Switch label="Push orders automatically" checked />
                <Switch label="Hold orders when the provider is unhealthy" checked description="Orders stay in QOS and are replayed instead of failing." />
                <Switch label="Send refunds to the provider" />
              </div>
            </Card>
          ) : null}
          {tab === "mapping" ? (
            <Card header="Catalogue mapping" subtitle="84 of 84 items mapped" padding="none">
              <DataTable
                density="dense"
                columns={[
                  { key: "name", header: "QOS product" },
                  { key: "provider", header: `${integration.name} item`, render: (r) => <code style={{ fontSize: 12 }}>{r.id.toUpperCase().slice(0, 8)}-01</code> },
                  { key: "category", header: "Category" },
                  { key: "state", header: "Mapping", render: (r) => <StatusBadge state={r.state === "draft" ? "config_required" : "synced"} /> },
                ]}
                rows={window.PRODUCTS}
              />
            </Card>
          ) : null}
          {tab === "locations" ? (
            <Card header="Location mapping" padding="none">
              <DataTable
                columns={[
                  { key: "name", header: "QOS location" },
                  { key: "site", header: "Provider site", render: (r) => <code style={{ fontSize: 12 }}>site_{r.id}</code> },
                  { key: "integration", header: "Health", render: (r) => <StatusBadge state={r.integration} /> },
                ]}
                rows={window.LOCATIONS}
              />
            </Card>
          ) : null}
          {tab === "logs" ? (
            <Card header="Activity & logs" subtitle="Technical detail is available but never required to resolve an issue.">
              <pre style={{ margin: 0, padding: 14, background: "var(--surface-sunken)", borderRadius: "var(--radius-card)", fontSize: 12, lineHeight: "18px", overflowX: "auto", color: "var(--text-secondary)" }}>{`14:07:02  POST /v3/orders        502  ord_8f31c9a2  Marina Walk
14:05:41  POST /v3/orders        502  ord_8f31c9a2  Marina Walk
14:04:12  POST /v3/orders        502  ord_7c22a118  Marina Walk
14:02:00  GET  /v3/health        degraded
13:45:10  POST /v3/catalogue     200  84 items      all locations
13:30:04  GET  /v3/health        healthy`}</pre>
            </Card>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 16 }}>
          <Card header="Status" padding="sm">
            <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-secondary)" }}>State</span><StatusBadge state={integration.state} /></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-secondary)" }}>Locations</span><strong>{integration.locations}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-secondary)" }}>Last sync</span><strong>13:45</strong></div>
            </div>
          </Card>
          <Card header="Who can change this" padding="sm">
            <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: "18px" }}>Managing integrations is restricted to Administrators. Users can view health and logs.</p>
          </Card>
        </div>
      </div>
      {toast ? <ToastStack><Toast tone="success" title="Done" onDismiss={() => onToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

Object.assign(window, { IntegrationsScreen });

}

/* ---- AnalyticsScreen.jsx ---- */
{
const { PageHeader, Card, Button, SegmentedControl, TrendChart, BarChart, ChartLegend, DataTable, Badge, StatusBadge, Select, IntelligenceCard, Icon, Tabs } = window.QOSDesignSystem_913581;

function AnalyticsScreen() {
  const [range, setRange] = React.useState("7 days");
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="One reporting model across channels, locations and products — the same data the operational screens use."
        actions={<>
          <Select id="loc" options={["All locations", "Marina Walk", "Downtown", "Al Quoz", "JBR Beachfront"]} />
          <SegmentedControl options={["24 hours", "7 days", "30 days", "Quarter"]} value={range} onChange={setRange} />
          <Button variant="secondary" icon="download">Export</Button>
        </>}
        tabs={<Tabs tabs={[{ id: "business", label: "Business" }, { id: "channels", label: "Channels" }, { id: "locations", label: "Locations" }, { id: "products", label: "Products" }, { id: "ops", label: "Operations" }]} value="business" onChange={() => {}} />}
      />

      <window.Grid cols={4} style={{ marginTop: 20 }}>
        {[["Revenue", "312,480", "AED", "6.4%", "up"], ["Orders", "8,914", "", "9.1%", "up"], ["Average order value", "35.05", "AED", "2.4%", "down"], ["Repeat customers", "41.2", "%", "1.1%", "up"]].map(([l, v, u, d, dir]) => (
          <Card key={l} padding="md">
            <div className="qos-kpi-label">{l}</div>
            <div className="qos-kpi-value">{v}{u ? <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-secondary)", marginLeft: 3 }}>{u}</span> : null}</div>
            <span className="qos-kpi-delta" data-dir={dir} style={{ marginTop: 8 }}><Icon name={dir === "up" ? "trending-up" : "trending-down"} size={13} />{d} vs. previous {range}</span>
          </Card>
        ))}
      </window.Grid>

      <window.Grid cols={3} style={{ marginTop: 16, alignItems: "start" }}>
        <Card header="Revenue by day" subtitle={`Last ${range}`} style={{ gridColumn: "span 2" }}>
          <TrendChart
            series={[{ label: "This period", values: window.REVENUE_TREND }, { label: "Previous period", values: window.REVENUE_TREND.map((v, i) => Math.round(v * (0.82 + (i % 5) * 0.03))) }]}
            labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
            height={220}
            valueFormat={(v) => `${v}k`}
          />
          <ChartLegend items={[{ label: "This period" }, { label: "Previous period" }]} style={{ marginTop: 12 }} />
        </Card>
        <Card header="Revenue by channel">
          <BarChart
            data={[{ label: "Store", value: 148 }, { label: "POS", value: 96 }, { label: "Deliveroo", value: 44 }, { label: "Talabat", value: 24 }]}
            height={186}
            valueFormat={(v) => `${v}k`}
          />
        </Card>
      </window.Grid>

      <window.Grid cols={3} style={{ marginTop: 16, alignItems: "start" }}>
        <Card header="Top products" padding="none" style={{ gridColumn: "span 2" }}>
          <DataTable
            density="dense"
            columns={[
              { key: "name", header: "Product" },
              { key: "category", header: "Category" },
              { key: "units", header: "Units", numeric: true, render: (r) => <span>{(r.variants * 412).toLocaleString()}</span> },
              { key: "rev", header: "Revenue (AED)", numeric: true, render: (r) => <span>{(r.variants * 8420).toLocaleString()}</span> },
              { key: "share", header: "Share", numeric: true, render: (r) => <span>{(r.variants * 4.1).toFixed(1)}%</span> },
              { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} /> },
            ]}
            rows={window.PRODUCTS.filter((p) => p.state === "published")}
          />
        </Card>
        <IntelligenceCard
          kind="Insight"
          title="Collection orders are growing twice as fast as delivery"
          claims={[
            { kind: "System fact", text: "Collection grew 18% and delivery 9% over the last 30 days." },
            { kind: "AI interpretation", text: "Growth is concentrated at Downtown and Al Quoz, both within 500m of an office cluster." },
            { kind: "AI recommendation", text: "Enable scheduled collection slots at those two branches." },
          ]}
          actions={<><Button variant="intelligence" icon="arrow-right">Review change</Button><Button variant="ghost">Dismiss</Button></>}
        />
      </window.Grid>

      <window.Grid cols={2} style={{ marginTop: 16, alignItems: "start" }}>
        <Card header="Location performance" padding="none">
          <DataTable
            density="dense"
            columns={[
              { key: "name", header: "Branch" },
              { key: "orders", header: "Orders", numeric: true, render: (r) => <span>{r.id === "marina" ? "2,918" : r.id === "downtown" ? "2,410" : r.id === "alquoz" ? "1,986" : "1,140"}</span> },
              { key: "aov", header: "AOV (AED)", numeric: true, render: () => <span>35.05</span> },
              { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} label={r.state === "warning" ? "Degraded" : undefined} /> },
            ]}
            rows={window.LOCATIONS}
          />
        </Card>
        <Card header="Operational reliability" subtitle="Integration and publishing health affect revenue, so they are reported here too.">
          <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
            {[["Order push success rate", "99.81%", "success"], ["Catalogue syncs completed", "1,344 of 1,346", "success"], ["Failed publishes", "1", "warning"], ["Orders held for replay", "9", "error"]].map(([l, v, tone]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 10, borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--text-secondary)" }}>{l}</span>
                <Badge tone={tone}>{v}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </window.Grid>
    </>
  );
}

Object.assign(window, { AnalyticsScreen });

}

/* ---- TeamSettingsScreen.jsx ---- */
{
const { PageHeader, Card, Button, DataTable, TableToolbar, SearchInput, Chip, StatusBadge, Badge, Drawer, Tabs, Avatar, Input, Select, Switch, Timeline, Alert, Icon, IconButton, Toast, ToastStack, ConfirmDialog, Radio, Checkbox, Pagination, EmptyState } = window.QOSDesignSystem_913581;

const MEMBERS = [
  { id: "jamie", name: "Jamie Doyle", email: "jamie.doyle@quotes.ae", role: "Administrator", scope: "All locations", state: "active", last: "Now" },
  { id: "priya", name: "Priya Nair", email: "priya.nair@quotes.ae", role: "Store manager", scope: "Online Store", state: "active", last: "2h ago" },
  { id: "omar", name: "Omar Haddad", email: "omar.haddad@quotes.ae", role: "Location manager", scope: "Marina Walk, JBR Beachfront", state: "active", last: "Yesterday" },
  { id: "sara", name: "Sara Lindqvist", email: "sara.l@quotes.ae", role: "Catalogue editor", scope: "All locations", state: "paused", last: "12d ago" },
  { id: "tom", name: "Tom Ekwueme", email: "tom.e@quotes.ae", role: "Location manager", scope: "Downtown", state: "pending", last: "Invited 3d ago" },
  { id: "qos", name: "QOS Support", email: "support@qosapp.com", role: "Platform support", scope: "Read only", state: "verified", last: "6d ago" },
];

const ROLES = [
  { id: "admin", name: "Administrator", count: 1, body: "Everything, including billing, team and integrations." },
  { id: "store", name: "Store manager", count: 1, body: "Sales channels, publishing, menus. Cannot change integrations." },
  { id: "loc", name: "Location manager", count: 2, body: "Orders, hours and availability for assigned locations only." },
  { id: "cat", name: "Catalogue editor", count: 1, body: "Products, modifiers and categories. Cannot publish." },
];

const ROLE_MATRIX = [
  ["View orders", true, true, true, false],
  ["Resolve order exceptions", true, true, true, false],
  ["Edit catalogue", true, true, false, true],
  ["Publish storefront releases", true, true, false, false],
  ["Pause a location", true, false, true, false],
  ["Connect integrations", true, false, false, false],
  ["Manage team and billing", true, false, false, false],
];

function TeamScreen() {
  const [tab, setTab] = React.useState("members");
  const [invite, setInvite] = React.useState(false);
  const [open, setOpen] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [remove, setRemove] = React.useState(null);
  const [members, setMembers] = React.useState(MEMBERS);

  const columns = [
    { key: "name", header: "Member", render: (r) => (
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={r.name} size="sm" />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 500 }}>{r.name}</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{r.email}</span>
        </span>
      </span>
    ) },
    { key: "role", header: "Role" },
    { key: "scope", header: "Scope" },
    { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} /> },
    { key: "last", header: "Last active", numeric: true },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="6 people have access to Quotes. Roles decide what they can change; scope decides where."
        actions={<><Button variant="secondary" icon="download">Export access log</Button><Button icon="user-plus" onClick={() => setInvite(true)}>Invite member</Button></>}
      />
      <div style={{ marginTop: 20 }}>
        <Tabs tabs={[{ id: "members", label: "Members", count: members.length }, { id: "roles", label: "Roles" }, { id: "log", label: "Access log" }]} value={tab} onChange={setTab} />
      </div>

      {tab === "members" ? (
        <Card padding="none" style={{ marginTop: 16 }}>
          <TableToolbar>
            <SearchInput placeholder="Name or email" style={{ width: 240 }} />
            <Chip selected>All</Chip>
            <Chip count={1}>Pending</Chip>
            <Chip>Administrators</Chip>
          </TableToolbar>
          <DataTable columns={columns} rows={members} density="dense" onRowClick={(r) => setOpen(r)} />
          <Pagination page={1} pageCount={1} pageSize={members.length} total={members.length} />
        </Card>
      ) : null}

      {tab === "roles" ? (
        <>
          <window.Grid cols={4} style={{ marginTop: 16 }}>
            {ROLES.map((r) => (
              <Card key={r.id} padding="sm">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</strong>
                  <Badge tone="neutral">{r.count} {r.count === 1 ? "member" : "members"}</Badge>
                </div>
                <p style={{ marginTop: 8, fontSize: 13, lineHeight: "18px", color: "var(--text-secondary)" }}>{r.body}</p>
              </Card>
            ))}
          </window.Grid>
          <Card header="Permissions by role" subtitle="Roles are fixed on the QOS platform. Scope is set per member." padding="none" style={{ marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-secondary)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600 }}>
                  <th style={{ textAlign: "left", padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)" }}>Permission</th>
                  {ROLES.map((r) => <th key={r.id} style={{ textAlign: "center", padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)" }}>{r.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROLE_MATRIX.map(([label, ...cells]) => (
                  <tr key={label}>
                    <td style={{ padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)" }}>{label}</td>
                    {cells.map((v, i) => (
                      <td key={i} style={{ textAlign: "center", padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", color: v ? "var(--status-success-fg)" : "var(--text-disabled)" }}>
                        <Icon name={v ? "check" : "minus"} size={14} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}

      {tab === "log" ? (
        <Card style={{ marginTop: 16 }}>
          <Timeline items={[
            { title: "Jamie Doyle approved “Reconnect Lightspeed”", meta: "Today 14:12 · Home · 9 orders replayed", tone: "success", icon: "check" },
            { title: "Tom Ekwueme invited as Location manager", meta: "3d ago · Jamie Doyle · Downtown", tone: "neutral", icon: "user-plus" },
            { title: "Sara Lindqvist paused", meta: "12d ago · Jamie Doyle · No activity for 30 days", tone: "neutral", icon: "pause" },
            { title: "QOS Support granted read-only access", meta: "6d ago · Priya Nair · Support ticket #4181, expires in 24d", tone: "neutral", icon: "shield-check" },
            { title: "Failed sign-in for priya.nair@quotes.ae", meta: "8d ago · 3 attempts from a new device · Resolved", tone: "warning", icon: "alert-triangle" },
          ]} />
        </Card>
      ) : null}

      {open ? (
        <Drawer
          title={<span style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={open.name} size="sm" />{open.name}<StatusBadge state={open.state} /></span>}
          description={open.email}
          onClose={() => setOpen(null)}
          footer={<>
            <Button variant="ghost" onClick={() => { setRemove(open); }}>Remove access</Button>
            <Button onClick={() => { setToast(`${open.name}'s access updated`); setOpen(null); }}>Save changes</Button>
          </>}
        >
          <div style={{ display: "grid", gap: 16 }}>
            {open.state === "pending" ? <Alert tone="info" title="Invitation not accepted yet" actions={<Button size="sm" variant="secondary" onClick={() => setToast("Invitation resent to " + open.email)}>Resend</Button>}>Sent 3 days ago. Expires in 4 days.</Alert> : null}
            <Select label="Role" value={open.role} options={ROLES.map((r) => r.name)} onChange={() => {}} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Location scope</div>
              <div style={{ display: "grid", gap: 8 }}>
                {window.LOCATIONS.map((l) => <Checkbox key={l.id} label={l.name} description={l.city} onChange={() => {}} checked={open.scope === "All locations" || open.scope.includes(l.name)} />)}
              </div>
            </div>
            <Switch label="Can approve AI recommendations" description="Applies recommended actions after review. Administrators always can." checked={open.role !== "Catalogue editor"} onChange={() => {}} />
            <Switch label="Two-factor authentication" description="Required for Administrators." checked disabled={open.role === "Administrator"} onChange={() => {}} />
          </div>
        </Drawer>
      ) : null}

      {invite ? (
        <Drawer
          title="Invite a team member"
          description="They will receive an email with a link that expires in 7 days."
          onClose={() => setInvite(false)}
          footer={<><Button variant="ghost" onClick={() => setInvite(false)}>Cancel</Button><Button icon="send" onClick={() => { setInvite(false); setMembers((m) => [...m, { id: "new", name: "Lena Farouk", email: "lena.farouk@quotes.ae", role: "Location manager", scope: "Al Quoz", state: "pending", last: "Invited just now" }]); setToast("Invitation sent to lena.farouk@quotes.ae"); }}>Send invitation</Button></>}
        >
          <div style={{ display: "grid", gap: 16 }}>
            <Input id="inv-email" label="Work email" placeholder="name@quotes.ae" defaultValue="lena.farouk@quotes.ae" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Role</div>
              <div style={{ display: "grid", gap: 8 }}>
                {ROLES.map((r, i) => <Radio key={r.id} name="inv-role" label={r.name} description={r.body} onChange={() => {}} checked={i === 2} />)}
              </div>
            </div>
            <Select label="Location scope" hint="Location managers see only their locations." value="Al Quoz" options={["All locations", ...window.LOCATIONS.map((l) => l.name)]} onChange={() => {}} />
          </div>
        </Drawer>
      ) : null}

      {remove ? (
        <ConfirmDialog
          tone="danger"
          title={`Remove ${remove.name}'s access?`}
          description={`${remove.name} will be signed out of QOS immediately and will no longer see Quotes. Their actions stay in the access log. Nothing else is deleted.`}
          confirmLabel="Remove access"
          onClose={() => setRemove(null)}
          onConfirm={() => { setMembers((m) => m.filter((x) => x.id !== remove.id)); setToast(`${remove.name} removed`); setRemove(null); setOpen(null); }}
        />
      ) : null}
      {toast ? <ToastStack><Toast tone="success" title="Team" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

function SettingsScreen() {
  const [tab, setTab] = React.useState("general");
  const [toast, setToast] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [notif, setNotif] = React.useState({ exceptions: true, publish: true, ai: true, digest: false });
  const [revealed, setRevealed] = React.useState(false);
  const [rotate, setRotate] = React.useState(false);
  const mark = () => setDirty(true);
  const save = () => { setDirty(false); setToast("Settings saved"); };
  const col = { display: "grid", gap: 16, maxWidth: 720 };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Business-wide configuration for Quotes. Location-specific settings live on each location."
        actions={dirty ? <><Button variant="ghost" onClick={() => setDirty(false)}>Discard</Button><Button onClick={save}>Save changes</Button></> : null}
      />
      <div style={{ marginTop: 20 }}>
        <Tabs tabs={[{ id: "general", label: "General" }, { id: "org", label: "Organisation" }, { id: "notif", label: "Notifications" }, { id: "api", label: "API keys" }, { id: "billing", label: "Billing" }]} value={tab} onChange={setTab} />
      </div>
      <div style={{ marginTop: 16 }}>
        {tab === "general" ? (
          <div style={col}>
            <Card header="Business" subtitle="Shown to customers on receipts and the storefront.">
              <div style={{ display: "grid", gap: 14 }}>
                <Input id="s-name" label="Business name" defaultValue="Quotes" onChange={mark} />
                <Input id="s-legal" label="Legal name" defaultValue="Quotes Hospitality LLC" hint="Appears on tax invoices." onChange={mark} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <Select label="Currency" value="AED" options={["AED", "SAR", "USD", "GBP", "EUR"]} onChange={mark} />
                  <Select label="Timezone" value="Asia/Dubai (GMT+4)" options={["Asia/Dubai (GMT+4)", "Asia/Riyadh (GMT+3)", "Europe/London (GMT+1)"]} onChange={mark} />
                </div>
                <Input id="s-trn" label="Tax registration number" defaultValue="100 3456 7890 0003" leadingIcon="file-text" onChange={mark} />
              </div>
            </Card>
            <Card header="Order handling" subtitle="Defaults for new locations. Each location can override.">
              <div style={{ display: "grid", gap: 14 }}>
                <Switch label="Hold orders when the POS is unreachable" description="QOS keeps paid orders and retries for up to 30 minutes rather than dropping them." checked onChange={mark} />
                <Switch label="Auto-accept online orders" description="Skip manual acceptance at the location." checked onChange={mark} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <Input id="s-prep" label="Default preparation time" defaultValue="15" trailing={<span style={{ fontSize: 12, color: "var(--text-secondary)" }}>min</span>} onChange={mark} />
                  <Input id="s-retry" label="POS retry window" defaultValue="30" trailing={<span style={{ fontSize: 12, color: "var(--text-secondary)" }}>min</span>} onChange={mark} />
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "org" ? (
          <div style={col}>
            <Card header="Structure" subtitle="Platform → Tenant → Organisation → Brand → Location." padding="none">
              {[
                ["Tenant", "Quotes", "quotes", "Live"],
                ["Organisation", "Quotes Hospitality LLC", "org_quotes_01", null],
                ["Brand", "Quotes", "brand_quotes", "12 locations · 4 channels"],
                ["Brand", "Quotes Express", "brand_qx", "Draft · 0 locations"],
              ].map(([kind, name, id, meta], i) => (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", paddingLeft: 20 + (kind === "Brand" ? 28 : kind === "Organisation" ? 14 : 0), borderBottom: i < 3 ? "1px solid var(--border-subtle)" : "none" }}>
                  <Icon name={kind === "Tenant" ? "building-2" : kind === "Organisation" ? "landmark" : "store"} size={15} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{name}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: ".14em" }}>{kind}</span>
                  </span>
                  <code style={{ fontSize: 12, color: "var(--text-secondary)" }}>{id}</code>
                  {meta ? <Badge tone={meta.startsWith("Draft") ? "neutral" : "success"}>{meta}</Badge> : null}
                </div>
              ))}
            </Card>
            <Card header="Data residency and isolation">
              <window.DefinitionList items={[
                { label: "Region", value: "UAE North (Azure)" },
                { label: "Database", value: <span>Shared cluster · row-level tenant isolation</span> },
                { label: "Storefront runtime", value: <span>Shared image · <code>quotes.qosapp.com</code></span> },
                { label: "Data export", value: <Button size="sm" variant="secondary" icon="download">Request export</Button> },
              ]} />
            </Card>
          </div>
        ) : null}

        {tab === "notif" ? (
          <div style={col}>
            <Card header="Operational alerts" subtitle="Sent to Administrators and the affected location's managers.">
              <div style={{ display: "grid", gap: 14 }}>
                <Switch label="Order exceptions" description="Payment or POS failures, as they happen." checked={notif.exceptions} onChange={(e) => { setNotif({ ...notif, exceptions: e.target.checked }); mark(); }} />
                <Switch label="Integration health changes" description="Connected → Disconnected, Out of sync, Configuration required." checked onChange={mark} />
                <Switch label="Publishing" description="Release published, failed or rolled back." checked={notif.publish} onChange={(e) => { setNotif({ ...notif, publish: e.target.checked }); mark(); }} />
                <Switch label="AI anomalies" description="Only anomalies with High confidence. Recommendations are never applied automatically." checked={notif.ai} onChange={(e) => { setNotif({ ...notif, ai: e.target.checked }); mark(); }} />
              </div>
            </Card>
            <Card header="Summaries">
              <div style={{ display: "grid", gap: 14 }}>
                <Switch label="Daily digest" description="Orders, revenue and exceptions by location, 07:00 local time." checked={notif.digest} onChange={(e) => { setNotif({ ...notif, digest: e.target.checked }); mark(); }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <Select label="Channel" value="Email" options={["Email", "Slack", "Email and Slack"]} onChange={mark} />
                  <Input id="s-slack" label="Slack channel" defaultValue="#quotes-ops" onChange={mark} />
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "api" ? (
          <div style={col}>
            <Alert tone="info" title="Keys are scoped to this tenant">Requests authenticate against Quotes only. Use a separate key per integration so it can be rotated on its own.</Alert>
            <Card header="Keys" actions={<Button size="sm" icon="plus" onClick={() => setToast("New key created · copy it now, it will not be shown again")}>Create key</Button>} padding="none">
              {[
                ["Storefront runtime", "qos_live_4f31•••••••••••••a9c2", "Read catalogue, write orders", "Used 2m ago", "verified"],
                ["Lightspeed connector", "qos_live_c8d0•••••••••••••17be", "Orders, locations", "Used 14:07 · failing", "error"],
                ["Reporting (Power BI)", "qos_live_b2e7•••••••••••••5d40", "Read only", "Used 6h ago", "active"],
              ].map(([name, key, scope, used, state], i) => (
                <div key={name} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr auto auto", alignItems: "center", gap: 16, padding: "12px 20px", borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none", fontSize: 13 }}>
                  <span><span style={{ display: "block", fontWeight: 500 }}>{name}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{scope}</span></span>
                  <code style={{ fontSize: 12 }}>{revealed && i === 0 ? "qos_live_4f31d8e2a77c19b0f3e5a9c2" : key}</code>
                  <span style={{ color: "var(--text-secondary)" }}>{used}</span>
                  <StatusBadge state={state} />
                  <span style={{ display: "flex", gap: 4 }}>
                    <IconButton icon={revealed && i === 0 ? "eye-off" : "eye"} label="Reveal" variant="ghost" onClick={() => i === 0 && setRevealed((v) => !v)} />
                    <IconButton icon="refresh-cw" label="Rotate" variant="ghost" onClick={() => setRotate(name)} />
                  </span>
                </div>
              ))}
            </Card>
            <Card header="Webhooks" subtitle="QOS posts order and publishing events to these endpoints.">
              <window.DefinitionList items={[
                { label: "order.created", value: <code>https://hooks.quotes.ae/qos/orders</code> },
                { label: "release.published", value: <code>https://hooks.quotes.ae/qos/releases</code> },
                { label: "Signing secret", value: <span style={{ display: "flex", gap: 8, alignItems: "center" }}><code>whsec_•••••••••••</code><Button size="sm" variant="ghost">Copy</Button></span> },
              ]} />
            </Card>
          </div>
        ) : null}

        {tab === "billing" ? (
          <div style={col}>
            <window.Grid cols={3}>
              <Card padding="sm"><div className="qos-kpi-label">Plan</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>Platform</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Annual · renews 1 Mar 2027</div></Card>
              <Card padding="sm"><div className="qos-kpi-label">Locations</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>12 <span style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 400 }}>of 15</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>3 included seats unused</div></Card>
              <Card padding="sm"><div className="qos-kpi-label">Orders this month</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>31,402</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Within the 50,000 allowance</div></Card>
            </window.Grid>
            <Card header="Invoices" padding="none" actions={<Button size="sm" variant="secondary" icon="credit-card">Update payment method</Button>}>
              {[["Sep 2026", "AED 9,600.00", "Paid"], ["Aug 2026", "AED 9,600.00", "Paid"], ["Jul 2026", "AED 8,800.00", "Paid"]].map(([m, a, s], i) => (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 20px", borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none", fontSize: 13 }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{m}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{a}</span>
                  <Badge tone="success" icon="check">{s}</Badge>
                  <IconButton icon="download" label="Download" variant="ghost" />
                </div>
              ))}
            </Card>
          </div>
        ) : null}
      </div>

      {rotate ? (
        <ConfirmDialog
          tone="danger"
          title={`Rotate the “${rotate}” key?`}
          description="The current key stops working in 24 hours. Anything still using it will start receiving 401 responses after that. The new key is shown once."
          confirmLabel="Rotate key"
          onClose={() => setRotate(false)}
          onConfirm={() => { setRotate(false); setToast(`${rotate} key rotated · old key expires in 24h`); }}
        />
      ) : null}
      {toast ? <ToastStack><Toast tone="success" title="Settings" onDismiss={() => setToast(null)}>{toast}</Toast></ToastStack> : null}
    </>
  );
}

const CUSTOMERS = [
  { id: "c1", name: "Aisha Rahman", phone: "+971 50 •••• 41", orders: 42, spend: "6,120.00", last: "Today 14:06", channel: "Online Store", tags: ["Regular"] },
  { id: "c2", name: "Luis Fernandes", phone: "+971 55 •••• 08", orders: 3, spend: "212.50", last: "Today 14:04", channel: "POS", tags: [] },
  { id: "c3", name: "Nadia Sharma", phone: "+971 52 •••• 77", orders: 18, spend: "1,940.25", last: "Today 13:54", channel: "Online Store", tags: ["Regular"] },
  { id: "c4", name: "Kwame Mensah", phone: "+971 50 •••• 19", orders: 1, spend: "128.00", last: "Today 13:49", channel: "POS", tags: ["New"] },
  { id: "c5", name: "Ravi Iyer", phone: "+971 56 •••• 63", orders: 9, spend: "486.00", last: "Today 13:41", channel: "Talabat", tags: [] },
  { id: "c6", name: "Daniela Costa", phone: "+971 54 •••• 30", orders: 27, spend: "1,102.50", last: "Today 13:37", channel: "Online Store", tags: ["Regular"] },
];

function CustomersScreen() {
  const [open, setOpen] = React.useState(null);
  const columns = [
    { key: "name", header: "Customer", render: (r) => <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={r.name} size="sm" /><span><span style={{ display: "block", fontWeight: 500 }}>{r.name}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{r.phone}</span></span></span> },
    { key: "channel", header: "Usual channel" },
    { key: "orders", header: "Orders", numeric: true },
    { key: "spend", header: "Lifetime spend (AED)", numeric: true },
    { key: "last", header: "Last order", numeric: true },
    { key: "tags", header: "", render: (r) => <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>{r.tags.map((t) => <Badge key={t} tone={t === "New" ? "info" : "neutral"}>{t}</Badge>)}</span> },
  ];
  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has ordered through a QOS channel. Identities are matched on phone number." actions={<Button variant="secondary" icon="download">Export</Button>} />
      <Card padding="none" style={{ marginTop: 20 }}>
        <TableToolbar>
          <SearchInput placeholder="Name or phone" style={{ width: 240 }} />
          <Chip selected>All customers</Chip>
          <Chip count={3}>Regulars</Chip>
          <Chip count={1}>New this week</Chip>
          <Chip>Online Store</Chip>
        </TableToolbar>
        <DataTable columns={columns} rows={CUSTOMERS} density="dense" onRowClick={setOpen} />
        <Pagination page={1} pageCount={214} pageSize={6} total={1283} />
      </Card>
      {open ? (
        <Drawer title={open.name} description={`${open.phone} · ${open.orders} orders · AED ${open.spend}`} onClose={() => setOpen(null)} footer={<><Button variant="ghost">Add note</Button><Button variant="secondary" icon="receipt">View orders</Button></>}>
          <div style={{ display: "grid", gap: 20 }}>
            <window.DefinitionList items={[
              { label: "Usual channel", value: open.channel },
              { label: "Usual location", value: "Marina Walk" },
              { label: "Marketing consent", value: "Given · 12 Mar 2026" },
              { label: "First order", value: "18 Jan 2026" },
            ]} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recent orders</div>
              <Timeline items={window.ORDERS.slice(0, 3).map((o) => ({ title: <><span style={{ fontFamily: "var(--font-mono)" }}>{o.id}</span> · AED {o.amount}</>, meta: `${o.time} · ${o.channel} · ${o.location}`, tone: o.exception ? "error" : "success", icon: o.exception ? "alert-circle" : "check" }))} />
            </div>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

Object.assign(window, { TeamScreen, SettingsScreen, CustomersScreen });

}

/* ---- StorefrontScreen.jsx ---- */
{
const { Button, Icon, Badge, Radio, Checkbox, Input, Timeline, IconButton, Select } = window.QOSDesignSystem_913581;

/* Customer-facing storefront rendered by the shared QOS Storefront runtime from Quotes' published
   configuration (Release 42). Imagery is placeholder — real product photography comes from the tenant. */
const STORE_CATEGORIES = ["Coffee", "Tea", "Kitchen", "Bakery", "Cold drinks", "Retail"];
const STORE_PRODUCTS = [
  { id: "flat-white", name: "Flat white", cat: "Coffee", price: 18, desc: "Double ristretto, velvety milk.", mods: true, popular: true },
  { id: "cortado", name: "Cortado", cat: "Coffee", price: 16, desc: "Equal parts espresso and steamed milk.", mods: true },
  { id: "cold-brew", name: "Cold brew", cat: "Coffee", price: 22, desc: "18-hour steep, served over ice.", mods: false },
  { id: "matcha", name: "Matcha latte", cat: "Tea", price: 24, desc: "Ceremonial grade, oat milk by default.", mods: true },
  { id: "chai", name: "Karak chai", cat: "Tea", price: 12, desc: "Slow-brewed with cardamom.", mods: false, popular: true },
  { id: "avo", name: "Avocado toast", cat: "Kitchen", price: 38, desc: "Sourdough, chilli, lime, feta.", mods: true, soldOut: true },
  { id: "shak", name: "Shakshuka", cat: "Kitchen", price: 42, desc: "Two eggs, peppers, warm flatbread.", mods: false },
  { id: "banana", name: "Banana bread", cat: "Bakery", price: 21, desc: "Toasted, salted butter.", mods: false, popular: true },
  { id: "croissant", name: "Almond croissant", cat: "Bakery", price: 19, desc: "Baked at 06:00 daily.", mods: false },
  { id: "lemonade", name: "Mint lemonade", cat: "Cold drinks", price: 20, desc: "Fresh mint, no added sugar.", mods: false },
  { id: "beans", name: "House blend, 250g", cat: "Retail", price: 65, desc: "Brazil and Ethiopia. Whole bean.", mods: false },
];

function Placeholder({ label, ratio = "4 / 3", radius = 12, style }) {
  return (
    <div style={{ aspectRatio: ratio, borderRadius: radius, background: "var(--surface-sunken)", border: "1px dashed var(--border-default)", display: "grid", placeItems: "center", color: "var(--text-tertiary)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", ...style }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="image" size={14} />{label}</span>
    </div>
  );
}

function StorefrontApp({ mobile = false, onExit }) {
  const [cat, setCat] = React.useState("Coffee");
  const [cart, setCart] = React.useState([{ id: "flat-white", qty: 2, note: "Oat milk, extra shot", price: 24 }]);
  const [sheet, setSheet] = React.useState(null);
  const [cartOpen, setCartOpen] = React.useState(false);
  const [stage, setStage] = React.useState("browse"); // browse | checkout | confirmed
  const [fulfil, setFulfil] = React.useState("Collection");
  const [milk, setMilk] = React.useState("Whole");
  const [shot, setShot] = React.useState(false);

  const count = cart.reduce((n, c) => n + c.qty, 0);
  const total = cart.reduce((n, c) => n + c.qty * c.price, 0);
  const add = (p) => {
    const price = p.price + (shot ? 4 : 0) + (milk === "Oat" ? 2 : 0);
    const note = p.mods ? [milk !== "Whole" ? `${milk} milk` : null, shot ? "Extra shot" : null].filter(Boolean).join(", ") : "";
    setCart((c) => [...c, { id: p.id, qty: 1, note, price }]);
    setSheet(null); setMilk("Whole"); setShot(false);
  };
  const cols = mobile ? 2 : 4;
  const pad = mobile ? 16 : 32;
  const visible = STORE_PRODUCTS.filter((p) => p.cat === cat);

  const Header = (
    <header style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--surface-default)", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: mobile ? 52 : 64, padding: `0 ${pad}px`, maxWidth: 1200, margin: "0 auto" }}>
        <span style={{ fontWeight: 700, fontSize: mobile ? 17 : 20, letterSpacing: "-.02em" }}>Quotes</span>
        <button type="button" style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", borderRadius: 999, border: "1px solid var(--border-default)", background: "var(--surface-subtle)", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", minWidth: 0 }}>
          <Icon name="map-pin" size={13} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Marina Walk · {fulfil}</span><Icon name="chevron-down" size={12} />
        </button>
        <span style={{ flex: 1 }} />
        {!mobile ? <nav style={{ display: "flex", gap: 20, fontSize: 14, color: "var(--text-secondary)" }}><a href="#">Menu</a><a href="#">Locations</a><a href="#">Our story</a></nav> : null}
        <button type="button" onClick={() => setCartOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 8, border: "none", background: "var(--action-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <Icon name="shopping-bag" size={14} />{count}{!mobile ? <span> · AED {total.toFixed(2)}</span> : null}
        </button>
      </div>
    </header>
  );

  if (stage === "confirmed") {
    return (
      <div style={{ minHeight: "100%", background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
        {mobile ? <div style={{ height: 54 }} /> : null}
        {Header}
        <div style={{ maxWidth: 560, margin: "0 auto", padding: `${mobile ? 24 : 56}px ${pad}px 80px`, display: "grid", gap: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: "var(--status-success-bg)", color: "var(--status-success-fg)", display: "grid", placeItems: "center" }}><Icon name="check" size={22} /></div>
          <div>
            <h1 style={{ fontSize: mobile ? 24 : 32, lineHeight: 1.2, letterSpacing: "-.02em", fontWeight: 600 }}>Order placed</h1>
            <p style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 15 }}>Order <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>QO-10429</span> · Ready for {fulfil.toLowerCase()} at Marina Walk in about 15 minutes.</p>
          </div>
          <div style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20 }}>
            <Timeline items={[
              { title: "Order received", meta: "Just now · quotes.qosapp.com", tone: "success", icon: "check" },
              { title: "Payment confirmed", meta: `AED ${(total + 2).toFixed(2)} · Visa •••• 4421`, tone: "success", icon: "credit-card" },
              { title: "Sent to the kitchen", meta: "Marina Walk", tone: "processing", icon: "chef-hat" },
              { title: `Ready for ${fulfil.toLowerCase()}`, meta: "Estimated 14:24", tone: "neutral", icon: "shopping-bag" },
            ]} />
          </div>
          <Button variant="secondary" fullWidth onClick={() => { setCart([]); setStage("browse"); }}>Back to menu</Button>
          {onExit ? <button type="button" onClick={onExit} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 12, cursor: "pointer" }}>Exit storefront preview</button> : null}
        </div>
      </div>
    );
  }

  if (stage === "checkout") {
    return (
      <div style={{ minHeight: "100%", background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
        {mobile ? <div style={{ height: 54 }} /> : null}
        {Header}
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: `${mobile ? 16 : 40}px ${pad}px 100px`, display: "grid", gridTemplateColumns: mobile ? "1fr" : "1.3fr 1fr", gap: mobile ? 16 : 32, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <button type="button" onClick={() => setStage("browse")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer", padding: 0, width: "fit-content" }}><Icon name="arrow-left" size={14} />Back to menu</button>
            <h1 style={{ fontSize: mobile ? 22 : 28, lineHeight: 1.2, letterSpacing: "-.02em", fontWeight: 600 }}>Checkout</h1>
            <section style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>How would you like it?</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Collection", "Ready in ~15 min", "shopping-bag"], ["Delivery", "35–45 min · AED 8", "truck"]].map(([k, m, ic]) => (
                  <button key={k} type="button" onClick={() => setFulfil(k)} style={{ textAlign: "left", padding: 14, borderRadius: 10, border: `1px solid ${fulfil === k ? "var(--action-primary)" : "var(--border-default)"}`, background: fulfil === k ? "var(--surface-selected)" : "var(--surface-default)", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", color: "inherit" }}>
                    <Icon name={ic} size={16} /><span><span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{k}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{m}</span></span>
                  </button>
                ))}
              </div>
            </section>
            <section style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Your details</h2>
              <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <Input id="sf-name" label="Name" defaultValue="Aisha Rahman" />
                <Input id="sf-phone" label="Mobile" defaultValue="+971 50 123 4541" hint="We text you when it is ready." />
              </div>
            </section>
            <section style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 12 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Payment</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, border: "1px solid var(--action-primary)", background: "var(--surface-selected)", fontSize: 14 }}>
                <Icon name="credit-card" size={16} /><span style={{ flex: 1 }}>Visa •••• 4421</span><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Change</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Payments are processed by Stripe. You are charged when the order is accepted.</p>
            </section>
          </div>
          <aside style={{ background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 20, display: "grid", gap: 14, position: mobile ? "static" : "sticky", top: 84 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600 }}>Order summary</h2>
            {cart.map((c, i) => { const p = STORE_PRODUCTS.find((x) => x.id === c.id); return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                <span>{c.qty} × {p.name}{c.note ? <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{c.note}</span> : null}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{(c.qty * c.price).toFixed(2)}</span>
              </div>
            ); })}
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, display: "grid", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{total.toFixed(2)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Service fee</span><span>2.00</span></div>
              {fulfil === "Delivery" ? <div style={{ display: "flex", justifyContent: "space-between" }}><span>Delivery</span><span>8.00</span></div> : null}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginTop: 4 }}><span>Total</span><span>AED {(total + 2 + (fulfil === "Delivery" ? 8 : 0)).toFixed(2)}</span></div>
            </div>
            <Button size="lg" fullWidth onClick={() => setStage("confirmed")}>Place order</Button>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%", height: mobile ? "100%" : undefined, display: mobile ? "flex" : undefined, flexDirection: "column", overflow: mobile ? "hidden" : undefined, background: "var(--surface-canvas)", color: "var(--text-primary)", fontFamily: "var(--font-sans)", position: "relative" }}>
      {mobile ? <div style={{ height: 54, flex: "none" }} /> : null}
      {Header}
      <div style={{ flex: mobile ? 1 : undefined, minHeight: 0, overflowY: mobile ? "auto" : undefined }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: `${mobile ? 16 : 28}px ${pad}px ${mobile ? 96 : 64}px`, display: "grid", gap: mobile ? 20 : 32 }}>
        <section style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 14 : 32, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 12, order: mobile ? 2 : 1 }}>
            <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-secondary)", fontWeight: 600 }}>Marina Walk · Open until 23:00</span>
            <h1 style={{ fontSize: mobile ? 28 : 44, lineHeight: 1.1, letterSpacing: "-.025em", fontWeight: 600 }}>Coffee worth quoting.</h1>
            <p style={{ fontSize: mobile ? 14 : 16, color: "var(--text-secondary)", maxWidth: 420 }}>Order ahead for collection, or get it delivered across Dubai Marina in under 45 minutes.</p>
            <div style={{ display: "flex", gap: 10 }}><Button size={mobile ? "md" : "lg"} onClick={() => setCat("Coffee")}>Order now</Button><Button size={mobile ? "md" : "lg"} variant="secondary">See locations</Button></div>
          </div>
          <Placeholder label="Hero image" ratio={mobile ? "16 / 9" : "5 / 4"} radius={16} style={{ order: mobile ? 1 : 2 }} />
        </section>

        <div id="sf-menu" style={{ position: "sticky", top: mobile ? 0 : 64, zIndex: 4, background: "var(--surface-canvas)", padding: "10px 0", display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
          {STORE_CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} style={{ flex: "none", height: 34, padding: "0 14px", borderRadius: 999, border: `1px solid ${cat === c ? "var(--text-primary)" : "var(--border-default)"}`, background: cat === c ? "var(--text-primary)" : "var(--surface-default)", color: cat === c ? "#fff" : "var(--text-primary)", fontSize: 13, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{c}</button>
          ))}
        </div>

        <section style={{ display: "grid", gap: 14 }}>
          <h2 style={{ fontSize: mobile ? 20 : 24, fontWeight: 600, letterSpacing: "-.015em" }}>{cat}</h2>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: mobile ? 12 : 20 }}>
            {visible.map((p) => (
              <button key={p.id} type="button" disabled={p.soldOut} onClick={() => setSheet(p)} style={{ textAlign: "left", padding: 0, background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 14, overflow: "hidden", cursor: p.soldOut ? "not-allowed" : "pointer", color: "inherit", opacity: p.soldOut ? 0.6 : 1, display: "grid" }}>
                <div style={{ position: "relative" }}>
                  <Placeholder label={p.name} radius={0} ratio="4 / 3" style={{ border: "none", borderBottom: "1px solid var(--border-subtle)" }} />
                  {p.popular ? <span style={{ position: "absolute", top: 10, left: 10 }}><Badge tone="neutral">Popular</Badge></span> : null}
                  {p.soldOut ? <span style={{ position: "absolute", top: 10, left: 10 }}><Badge tone="error">Sold out today</Badge></span> : null}
                </div>
                <div style={{ padding: mobile ? 12 : 14, display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: mobile ? 14 : 15, fontWeight: 600 }}><span>{p.name}</span><span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{p.price}</span></div>
                  <p style={{ fontSize: 12, lineHeight: "16px", color: "var(--text-secondary)" }}>{p.desc}</p>
                </div>
              </button>
            ))}
            {!visible.length ? <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Nothing in this category at Marina Walk right now.</p> : null}
          </div>
        </section>

        {!mobile ? (
          <footer style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 24, display: "flex", justifyContent: "space-between", gap: 24, fontSize: 12, color: "var(--text-tertiary)", flexWrap: "wrap" }}>
            <span>© 2026 Quotes Hospitality LLC · Dubai</span>
            <span style={{ display: "flex", gap: 16 }}><a href="#">Allergens</a><a href="#">Privacy</a><a href="#">Terms</a></span>
            <span>Powered by QOS</span>
          </footer>
        ) : null}
      </div>

      {mobile && count ? (
        <div style={{ position: "sticky", bottom: 0, padding: "10px 16px 20px", background: "linear-gradient(180deg, rgba(248,250,252,0), var(--surface-canvas) 40%)" }}>
          <Button size="lg" fullWidth onClick={() => setCartOpen(true)}><span style={{ display: "flex", justifyContent: "space-between", width: "100%" }}><span>View order · {count}</span><span>AED {total.toFixed(2)}</span></span></Button>
        </div>
      ) : null}

      </div>
      {sheet ? (
        <div onClick={() => setSheet(null)} style={{ position: mobile ? "absolute" : "fixed", inset: 0, background: "rgba(11,15,26,.48)", zIndex: 20, display: "grid", alignItems: mobile ? "end" : "center", justifyItems: "center", padding: mobile ? 0 : 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: mobile ? "100%" : 440, background: "var(--surface-default)", borderRadius: mobile ? "16px 16px 0 0" : 16, overflow: "hidden", boxShadow: "var(--shadow-xl)", maxHeight: "92%", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
            <Placeholder label={sheet.name} radius={0} ratio="16 / 9" style={{ border: "none" }} />
            <div style={{ padding: 20, display: "grid", gap: 16, overflowY: "auto" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 600 }}><span>{sheet.name}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>AED {sheet.price}</span></div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{sheet.desc}</p>
              </div>
              {sheet.mods ? (
                <>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Milk <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>· choose one</span></div>
                    {[["Whole", ""], ["Skimmed", ""], ["Oat", "+2.00"]].map(([m, extra]) => (
                      <label key={m} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                        <Radio name="milk" checked={milk === m} onChange={() => setMilk(m)} /><span style={{ flex: 1 }}>{m}</span><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{extra}</span>
                      </label>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                    <Checkbox checked={shot} onChange={(e) => setShot(e.target.checked)} /><span style={{ flex: 1 }}>Extra shot</span><span style={{ fontSize: 12, color: "var(--text-secondary)" }}>+4.00</span>
                  </label>
                </>
              ) : null}
            </div>
            <div style={{ padding: "12px 20px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: 10 }}>
              <Button variant="secondary" onClick={() => setSheet(null)}>Cancel</Button>
              <Button fullWidth onClick={() => add(sheet)}>Add · AED {(sheet.price + (shot ? 4 : 0) + (milk === "Oat" ? 2 : 0)).toFixed(2)}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {cartOpen ? (
        <div onClick={() => setCartOpen(false)} style={{ position: mobile ? "absolute" : "fixed", inset: 0, background: "rgba(11,15,26,.48)", zIndex: 20, display: "flex", justifyContent: "flex-end", alignItems: mobile ? "flex-end" : "stretch" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: mobile ? "100%" : 400, maxHeight: mobile ? "85%" : "100%", background: "var(--surface-default)", borderRadius: mobile ? "16px 16px 0 0" : 0, display: "grid", gridTemplateRows: "auto 1fr auto", boxShadow: "var(--shadow-xl)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Your order</span><IconButton icon="x" label="Close" size="sm" onClick={() => setCartOpen(false)} />
            </div>
            <div style={{ padding: 20, overflowY: "auto", display: "grid", gap: 14, alignContent: "start" }}>
              {!cart.length ? <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>Your order is empty. Add something from the menu.</p> : null}
              {cart.map((c, i) => { const p = STORE_PRODUCTS.find((x) => x.id === c.id); return (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14 }}>
                  <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 500 }}>{p.name}</span>{c.note ? <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{c.note}</span> : null}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border-default)", borderRadius: 8, height: 32 }}>
                    <button type="button" onClick={() => setCart((cs) => cs.map((x, j) => j === i ? { ...x, qty: x.qty - 1 } : x).filter((x) => x.qty > 0))} style={{ width: 32, height: 30, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>−</button>
                    <span style={{ width: 20, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{c.qty}</span>
                    <button type="button" onClick={() => setCart((cs) => cs.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x))} style={{ width: 32, height: 30, border: "none", background: "none", cursor: "pointer", color: "inherit" }}>+</button>
                  </span>
                  <span style={{ width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(c.qty * c.price).toFixed(2)}</span>
                </div>
              ); })}
            </div>
            <div style={{ padding: "14px 20px 20px", borderTop: "1px solid var(--border-subtle)", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600 }}><span>Subtotal</span><span>AED {total.toFixed(2)}</span></div>
              <Button size="lg" fullWidth disabled={!cart.length} onClick={() => { setCartOpen(false); setStage("checkout"); }}>Go to checkout</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

Object.assign(window, { StorefrontApp });

}

/* ---- ios-frame.jsx ---- */
{
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).

/* BEGIN USAGE */
// iOS.jsx — Simplified iOS 26 (Liquid Glass) device frame
// Based on the iOS 26 UI Kit + Figma status bar spec. No assets, no deps.
// Exports (to window): IOSDevice, IOSStatusBar, IOSNavBar, IOSGlassPill, IOSList, IOSListRow, IOSKeyboard
//
// Usage — wrap your screen content in <IOSDevice> to get the bezel, status bar
// and home indicator (props: title, dark, keyboard):
//
//   <IOSDevice title="Settings">
//     ...your screen content...
//   </IOSDevice>
//   <IOSDevice dark title="Search" keyboard>…</IOSDevice>
/* END USAGE */

// ─────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────
function IOSStatusBar({ dark = false, time = '9:41' }) {
  const c = dark ? '#fff' : '#000';
  return (
    <div style={{
      display: 'flex', gap: 154, alignItems: 'center', justifyContent: 'center',
      padding: '21px 24px 19px', boxSizing: 'border-box',
      position: 'relative', zIndex: 20, width: '100%',
    }}>
      <div style={{ flex: 1, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 1.5 }}>
        <span style={{
          fontFamily: '-apple-system, "SF Pro", system-ui', fontWeight: 590,
          fontSize: 17, lineHeight: '22px', color: c,
        }}>{time}</span>
      </div>
      <div style={{ flex: 1, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 1, paddingRight: 1 }}>
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c}/>
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c}/>
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c}/>
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c}/>
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z" fill={c}/>
          <path d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z" fill={c}/>
          <circle cx="8.5" cy="10.5" r="1.5" fill={c}/>
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke={c} strokeOpacity="0.35" fill="none"/>
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c}/>
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4"/>
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Liquid glass pill — blur + tint + shine
// ─────────────────────────────────────────────────────────────
function IOSGlassPill({ children, dark = false, style = {} }) {
  return (
    <div style={{
      height: 44, minWidth: 44, borderRadius: 9999,
      position: 'relative', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: dark
        ? '0 2px 6px rgba(0,0,0,0.35), 0 6px 16px rgba(0,0,0,0.2)'
        : '0 1px 3px rgba(0,0,0,0.07), 0 3px 10px rgba(0,0,0,0.06)',
      ...style,
    }}>
      {/* blur + tint */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 9999,
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        background: dark ? 'rgba(120,120,128,0.28)' : 'rgba(255,255,255,0.5)',
      }} />
      {/* shine */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 9999,
        boxShadow: dark
          ? 'inset 1.5px 1.5px 1px rgba(255,255,255,0.15), inset -1px -1px 1px rgba(255,255,255,0.08)'
          : 'inset 1.5px 1.5px 1px rgba(255,255,255,0.7), inset -1px -1px 1px rgba(255,255,255,0.4)',
        border: dark ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid rgba(0,0,0,0.06)',
      }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', padding: '0 4px' }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Navigation bar — glass pills + large title
// ─────────────────────────────────────────────────────────────
function IOSNavBar({ title = 'Title', dark = false, trailingIcon = true }) {
  const muted = dark ? 'rgba(255,255,255,0.6)' : '#404040';
  const text = dark ? '#fff' : '#000';
  const pillIcon = (content) => (
    <IOSGlassPill dark={dark}>
      <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {content}
      </div>
    </IOSGlassPill>
  );
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      paddingTop: 62, paddingBottom: 10, position: 'relative', zIndex: 5,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
      }}>
        {/* back chevron */}
        {pillIcon(
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none" style={{ marginLeft: -1 }}>
            <path d="M10 2L2 10l8 8" stroke={muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        {/* trailing ellipsis */}
        {trailingIcon && pillIcon(
          <svg width="22" height="6" viewBox="0 0 22 6">
            <circle cx="3" cy="3" r="2.5" fill={muted}/>
            <circle cx="11" cy="3" r="2.5" fill={muted}/>
            <circle cx="19" cy="3" r="2.5" fill={muted}/>
          </svg>
        )}
      </div>
      {/* large title */}
      <div style={{
        padding: '0 16px',
        fontFamily: '-apple-system, system-ui',
        fontSize: 34, fontWeight: 700, lineHeight: '41px',
        color: text, letterSpacing: 0.4,
      }}>{title}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Grouped list (inset card, r:26) + row (52px)
// ─────────────────────────────────────────────────────────────
function IOSListRow({ title, detail, icon, chevron = true, isLast = false, dark = false }) {
  const text = dark ? '#fff' : '#000';
  const sec = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const ter = dark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)';
  const sep = dark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', minHeight: 52,
      padding: '0 16px', position: 'relative',
      fontFamily: '-apple-system, system-ui', fontSize: 17,
      letterSpacing: -0.43,
    }}>
      {icon && (
        <div style={{
          width: 30, height: 30, borderRadius: 7, background: icon,
          marginRight: 12, flexShrink: 0,
        }} />
      )}
      <div style={{ flex: 1, color: text }}>{title}</div>
      {detail && <span style={{ color: sec, marginRight: 6 }}>{detail}</span>}
      {chevron && (
        <svg width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0 }}>
          <path d="M1 1l6 6-6 6" stroke={ter} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {!isLast && (
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          left: icon ? 58 : 16, height: 0.5, background: sep,
        }} />
      )}
    </div>
  );
}

function IOSList({ header, children, dark = false }) {
  const hc = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const bg = dark ? '#1C1C1E' : '#fff';
  return (
    <div>
      {header && (
        <div style={{
          fontFamily: '-apple-system, system-ui', fontSize: 13,
          color: hc, textTransform: 'uppercase',
          padding: '8px 36px 6px', letterSpacing: -0.08,
        }}>{header}</div>
      )}
      <div style={{
        background: bg, borderRadius: 26,
        margin: '0 16px', overflow: 'hidden',
      }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Device frame
// ─────────────────────────────────────────────────────────────
function IOSDevice({
  children, width = 402, height = 874, dark = false,
  title, keyboard = false,
}) {
  return (
    // data-om-starter: inert presence marker — Claude Design's starter-usage
    // probe reads it; it renders nothing. Keep it on this root element.
    <div data-om-starter="ios-frame" style={{
      width, height, borderRadius: 48, overflow: 'hidden',
      position: 'relative', background: dark ? '#000' : '#F2F2F7',
      boxShadow: '0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)',
      fontFamily: '-apple-system, system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* dynamic island */}
      <div style={{
        position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
        width: 126, height: 37, borderRadius: 24, background: '#000', zIndex: 50,
      }} />
      {/* status bar (absolute) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
        <IOSStatusBar dark={dark} />
      </div>
      {/* nav + content */}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {title !== undefined && <IOSNavBar title={title} dark={dark} />}
        <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
        {keyboard && <IOSKeyboard dark={dark} />}
      </div>
      {/* home indicator — always on top */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60,
        height: 34, display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
        paddingBottom: 8, pointerEvents: 'none',
      }}>
        <div style={{
          width: 139, height: 5, borderRadius: 100,
          background: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.25)',
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Keyboard — iOS 26 liquid glass
// ─────────────────────────────────────────────────────────────
function IOSKeyboard({ dark = false }) {
  const glyph = dark ? 'rgba(255,255,255,0.7)' : '#595959';
  const sugg = dark ? 'rgba(255,255,255,0.6)' : '#333';
  const keyBg = dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.85)';

  // special-key icons
  const icons = {
    shift: <svg width="19" height="17" viewBox="0 0 19 17"><path d="M9.5 1L1 9.5h4.5V16h8V9.5H18L9.5 1z" fill={glyph}/></svg>,
    del: <svg width="23" height="17" viewBox="0 0 23 17"><path d="M7 1h13a2 2 0 012 2v11a2 2 0 01-2 2H7l-6-7.5L7 1z" fill="none" stroke={glyph} strokeWidth="1.6" strokeLinejoin="round"/><path d="M10 5l7 7M17 5l-7 7" stroke={glyph} strokeWidth="1.6" strokeLinecap="round"/></svg>,
    ret: <svg width="20" height="14" viewBox="0 0 20 14"><path d="M18 1v6H4m0 0l4-4M4 7l4 4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  };

  const key = (content, { w, flex, ret, fs = 25, k } = {}) => (
    <div key={k} style={{
      height: 42, borderRadius: 8.5,
      flex: flex ? 1 : undefined, width: w, minWidth: 0,
      background: ret ? '#08f' : keyBg,
      boxShadow: '0 1px 0 rgba(0,0,0,0.075)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, "SF Compact", system-ui',
      fontSize: fs, fontWeight: 458, color: ret ? '#fff' : glyph,
    }}>{content}</div>
  );

  const row = (keys, pad = 0) => (
    <div style={{ display: 'flex', gap: 6.5, justifyContent: 'center', padding: `0 ${pad}px` }}>
      {keys.map(l => key(l, { flex: true, k: l }))}
    </div>
  );

  return (
    <div style={{
      position: 'relative', zIndex: 15, borderRadius: 27, overflow: 'hidden',
      padding: '11px 0 2px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      boxShadow: dark
        ? '0 -2px 20px rgba(0,0,0,0.09)'
        : '0 -1px 6px rgba(0,0,0,0.018), 0 -3px 20px rgba(0,0,0,0.012)',
    }}>
      {/* liquid glass bg — same recipe as nav pills */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 27,
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        background: dark ? 'rgba(120,120,128,0.14)' : 'rgba(255,255,255,0.25)',
      }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 27,
        boxShadow: dark
          ? 'inset 1.5px 1.5px 1px rgba(255,255,255,0.15)'
          : 'inset 1.5px 1.5px 1px rgba(255,255,255,0.7), inset -1px -1px 1px rgba(255,255,255,0.4)',
        border: dark ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid rgba(0,0,0,0.06)',
        pointerEvents: 'none',
      }} />

      {/* autocorrect bar */}
      <div style={{
        display: 'flex', gap: 20, alignItems: 'center',
        padding: '8px 22px 13px', width: '100%', boxSizing: 'border-box',
        position: 'relative',
      }}>
        {['"The"', 'the', 'to'].map((w, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div style={{ width: 1, height: 25, background: '#ccc', opacity: 0.3 }} />}
            <div style={{
              flex: 1, textAlign: 'center',
              fontFamily: '-apple-system, system-ui', fontSize: 17,
              color: sugg, letterSpacing: -0.43, lineHeight: '22px',
            }}>{w}</div>
          </React.Fragment>
        ))}
      </div>

      {/* key layout */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 13,
        padding: '0 6.5px', width: '100%', boxSizing: 'border-box',
        position: 'relative',
      }}>
        {row(['q','w','e','r','t','y','u','i','o','p'])}
        {row(['a','s','d','f','g','h','j','k','l'], 20)}
        <div style={{ display: 'flex', gap: 14.25, alignItems: 'center' }}>
          {key(icons.shift, { w: 45, k: 'shift' })}
          <div style={{ display: 'flex', gap: 6.5, flex: 1 }}>
            {['z','x','c','v','b','n','m'].map(l => key(l, { flex: true, k: l }))}
          </div>
          {key(icons.del, { w: 45, k: 'del' })}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {key('ABC', { w: 92.25, fs: 18, k: 'abc' })}
          {key('', { flex: true, k: 'space' })}
          {key(icons.ret, { w: 92.25, ret: true, k: 'ret' })}
        </div>
      </div>

      {/* bottom spacer (emoji+mic area, icons omitted) */}
      <div style={{ height: 56, width: '100%', position: 'relative' }} />
    </div>
  );
}

Object.assign(window, {
  IOSDevice, IOSStatusBar, IOSNavBar, IOSGlassPill, IOSList, IOSListRow, IOSKeyboard,
});

}

/* ---- MobileApp.jsx ---- */
{
const { Button, Icon, Badge, StatusBadge, KpiCard, Alert, Timeline, Switch, Avatar, Toast, ToastStack, ConfirmDialog, SearchInput, Chip, Sparkline } = window.QOSDesignSystem_913581;

/* Mobile platform: monitoring and focused actions only (approve, pause, resolve).
   Configuration workflows stay on desktop, per the QOS responsive rules. */
const M_TABS = [
  { id: "home", label: "Home", icon: "layout-dashboard" },
  { id: "orders", label: "Orders", icon: "receipt", count: 3 },
  { id: "locations", label: "Locations", icon: "map-pin" },
  { id: "more", label: "More", icon: "menu" },
];

function MHeader({ title, sub, right, onBack }) {
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

function MCard({ children, style, onClick }) {
  const Tag = onClick ? "button" : "div";
  return <Tag type={onClick ? "button" : undefined} onClick={onClick} style={{ textAlign: "left", background: "var(--surface-default)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 14, boxShadow: "var(--shadow-sm)", color: "inherit", font: "inherit", cursor: onClick ? "pointer" : undefined, width: "100%", ...style }}>{children}</Tag>;
}

function MobilePlatform({ theme = "light" }) {
  const [tab, setTab] = React.useState("home");
  const [order, setOrder] = React.useState(null);
  const [confirm, setConfirm] = React.useState(false);
  const [resolved, setResolved] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [paused, setPaused] = React.useState({ jbr: true });
  const [view, setView] = React.useState("exceptions");

  const orders = view === "exceptions" ? window.ORDERS.filter((o) => o.exception) : window.ORDERS;

  const body = order ? (
    <>
      <MHeader title={<span style={{ fontFamily: "var(--font-mono)" }}>{order.id}</span>} sub={`${order.channel} · ${order.location} · ${order.time}`} onBack={() => setOrder(null)} right={<StatusBadge state={order.state} />} />
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 12 }}>
        {order.exception ? <Alert tone="error" title="Not sent to the POS">Lightspeed returned 502 on 3 attempts. The customer has paid AED {order.amount}.</Alert> : null}
        <MCard>
          <window.DefinitionList items={[
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
            <Sparkline values={window.ORDER_TREND} tone="var(--viz-1)" />
          </div>
        </MCard>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600, color: "var(--text-secondary)", marginTop: 8 }}>Channels</div>
        <MCard style={{ padding: 0 }}>
          {window.CHANNELS.slice(0, 4).map((c, i) => (
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
          <MCard key={o.id} onClick={() => setOrder(o)} style={o.exception ? { borderColor: "var(--status-error-border)" } : null}>
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
        {window.LOCATIONS.map((l) => (
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

Object.assign(window, { MobilePlatform });

}

/* ---- QOSPrototype.jsx ---- */
{
const { Button, Icon, Badge, EmptyState, PageHeader, Card, Logo } = window.QOSDesignSystem_913581;

function QOSPrototype({ device: deviceProp = "desktop", surface: surfaceProp = "platform", skipLogin = false, startScreen = "home" }) {
  const [device, setDevice] = React.useState(deviceProp);
  const [surface, setSurface] = React.useState(surfaceProp);
  React.useEffect(() => setDevice(deviceProp), [deviceProp]);
  React.useEffect(() => setSurface(surfaceProp), [surfaceProp]);

  const [stage, setStage] = React.useState(skipLogin ? "app" : "login");
  React.useEffect(() => { if (skipLogin) setStage("app"); }, [skipLogin]);
  const [screen, setScreen] = React.useState(startScreen);
  const [tenant, setTenant] = React.useState("quotes");
  const [theme, setTheme] = React.useState(() => localStorage.getItem("qos-proto-theme") || "light");
  const setThemePersisted = (t) => { setTheme(t); localStorage.setItem("qos-proto-theme", t); };
  window.__go = setScreen;

  const screens = {
    home: <window.HomeScreen onNavigate={setScreen} />,
    orders: <window.OrdersScreen />,
    catalogue: <window.CatalogueScreen />,
    menus: <window.CatalogueScreen />,
    modifiers: <window.CatalogueScreen />,
    categories: <window.CatalogueScreen />,
    customers: <window.CustomersScreen />,
    channels: <window.ChannelsScreen />,
    store: <window.ChannelsScreen />,
    pos: <window.IntegrationsScreen />,
    locations: <window.LocationsScreen />,
    integrations: <window.IntegrationsScreen />,
    analytics: <window.AnalyticsScreen />,
    team: <window.TeamScreen />,
    settings: <window.SettingsScreen />,
  };

  let content;
  if (surface === "storefront") {
    content = device === "mobile"
      ? <PhoneStage><window.StorefrontApp mobile /></PhoneStage>
      : <div style={{ height: "100vh", overflowY: "auto" }}><window.StorefrontApp onExit={() => setSurface("platform")} /></div>;
  } else if (device === "mobile") {
    content = <PhoneStage><window.MobilePlatform theme={theme} /></PhoneStage>;
  } else if (stage !== "app") {
    content = <window.LoginScreen step={stage} onSignIn={() => setStage("tenant")} onPickTenant={(id) => { setTenant(id); setStage("app"); }} />;
  } else {
    content = (
      <window.AppShell screen={screen} onNavigate={setScreen} tenant={tenant} onTenantChange={setTenant} theme={theme} onThemeChange={setThemePersisted}>
        {screens[screen] || <><PageHeader title="Screen" /><Card style={{ marginTop: 20 }}><EmptyState icon="layout-dashboard" title="Not in this prototype" actions={<Button variant="secondary" onClick={() => setScreen("home")}>Back to Home</Button>} /></Card></>}
      </window.AppShell>
    );
  }

  const seg = (items, value, onChange) => (
    <span style={{ display: "inline-flex", background: "rgba(255,255,255,.08)", borderRadius: 8, padding: 2 }}>
      {items.map(([id, label, icon]) => (
        <button key={id} type="button" onClick={() => onChange(id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", background: value === id ? "#fff" : "transparent", color: value === id ? "#0B0F1A" : "#94A3B8" }}>
          <Icon name={icon} size={13} />{label}
        </button>
      ))}
    </span>
  );

  return (
    <div style={{ position: "relative", fontFamily: "var(--font-sans)" }}>
      {content}
      <div data-proto-bar style={{ position: "fixed", left: "50%", bottom: 14, transform: "translateX(-50%)", zIndex: 1000, display: "flex", alignItems: "center", gap: 10, padding: "6px 8px 6px 14px", borderRadius: 999, background: "#0B0F1A", color: "#fff", boxShadow: "0 8px 24px rgba(11,15,26,.35)", border: "1px solid rgba(255,255,255,.1)" }}>
        <span style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "#94A3B8", fontWeight: 600 }}>Prototype</span>
        {seg([["platform", "Platform", "layout-dashboard"], ["storefront", "Storefront", "shopping-bag"]], surface, setSurface)}
        {seg([["desktop", "Desktop", "monitor"], ["mobile", "Mobile", "smartphone"]], device, setDevice)}
        {surface === "platform" && device === "desktop" && stage === "app" ? <button type="button" onClick={() => setStage("login")} style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "#94A3B8", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>Sign out</button> : null}
      </div>
    </div>
  );
}

function PhoneStage({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 24px 80px", background: "#E6EAF1" }}>
      <window.IOSDevice>{children}</window.IOSDevice>
    </div>
  );
}

Object.assign(window, { QOSPrototype });

}
