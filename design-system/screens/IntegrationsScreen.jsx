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
