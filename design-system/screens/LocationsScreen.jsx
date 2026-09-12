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
