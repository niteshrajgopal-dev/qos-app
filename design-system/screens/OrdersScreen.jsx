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
