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
