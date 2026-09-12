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
              <Logo variant="light" height={16} assetBase="../../assets/" />
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
