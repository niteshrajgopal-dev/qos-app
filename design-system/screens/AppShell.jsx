const { SideNav, TopBar, TenantSwitcher, SearchInput, IconButton, Avatar, Badge, Logo, Banner, Button, CommandPalette } = window.QOSDesignSystem_913581;

function AppShell({ screen, onNavigate, tenant, onTenantChange, banner, children, theme = "light", onThemeChange }) {
  const [cmd, setCmd] = React.useState(false);
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmd(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div data-qos-theme={theme} style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--surface-canvas)", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", flex: "none" }}>
        <SideNav
          brand={<Logo variant={theme === "dark" ? "navy" : "light"} height={17} assetBase="../../assets/" />}
          groups={window.NAV}
          activeId={screen}
          onNavigate={onNavigate}
          footer={
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
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar>
          <TenantSwitcher tenants={window.TENANTS} value={tenant} onChange={onTenantChange} />
          <button type="button" onClick={() => setCmd(true)} style={{ flex: 1, minWidth: 0, maxWidth: 380, height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--surface-subtle)", color: "var(--text-placeholder)", fontSize: 13, cursor: "pointer", overflow: "hidden" }}>
            <span className="qos-badge" style={{ border: "none", background: "none", padding: 0, color: "var(--text-tertiary)", flex: "none" }}>⌕</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>Search businesses, orders, products, locations…</span>
            <span className="qos-kbd" style={{ flex: "none" }}>⌘K</span>
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <Badge tone="processing" dot pulse>Development</Badge>
            <IconButton
              icon={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => onThemeChange && onThemeChange(theme === "dark" ? "light" : "dark")}
            />
            <IconButton icon="circle-help" label="Help" />
            <span style={{ position: "relative", display: "inline-flex" }}>
              <IconButton icon="bell" label="Notifications" />
              <span style={{ position: "absolute", top: 5, right: 5, width: 7, height: 7, borderRadius: 999, background: "var(--status-error-solid)", border: "1.5px solid var(--surface-default)" }} />
            </span>
            <Avatar name="Jamie Doyle" size="sm" />
          </div>
        </TopBar>
        {banner}
        <main style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: "var(--layout-canvas-max)", margin: "0 auto", padding: "24px var(--layout-gutter) 64px" }}>{children}</div>
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
