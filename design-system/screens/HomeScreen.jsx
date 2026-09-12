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
