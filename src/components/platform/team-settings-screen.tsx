"use client";

// Direct port of the design prototype. Markup and copy are kept as specified.
import React from "react";

import { usePlatformData } from "@/mocks/use-platform-data";
import { Grid, DefinitionList } from "@/components/platform/layout";
import { PageHeader, Card, Button, DataTable, TableToolbar, SearchInput, Chip, StatusBadge, Badge, Drawer, Tabs, Avatar, Input, Select, Switch, Timeline, Alert, Icon, IconButton, Toast, ToastStack, ConfirmDialog, Radio, Checkbox, Pagination, EmptyState } from "@/design-system";

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

export function TeamScreen() {
  const platform = usePlatformData();
  type Member = typeof MEMBERS[number];
  const [tab, setTab] = React.useState("members");
  const [invite, setInvite] = React.useState(false);
  const [open, setOpen] = React.useState<Member | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [remove, setRemove] = React.useState<Member | null>(null);
  const [members, setMembers] = React.useState<typeof MEMBERS>(MEMBERS);

  const columns = [
    { key: "name", header: "Member", render: (r: Member) => (
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
    { key: "state", header: "Status", render: (r: Member) => <StatusBadge state={r.state} /> },
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
          <Grid cols={4} style={{ marginTop: 16 }}>
            {ROLES.map((r) => (
              <Card key={r.id} padding="sm">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</strong>
                  <Badge tone="neutral">{r.count} {r.count === 1 ? "member" : "members"}</Badge>
                </div>
                <p style={{ marginTop: 8, fontSize: 13, lineHeight: "18px", color: "var(--text-secondary)" }}>{r.body}</p>
              </Card>
            ))}
          </Grid>
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
                  <tr key={label as string}>
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
            { title: "Failed sign-in for priya.nair@quotes.ae", meta: "8d ago · 3 attempts from a new device · Resolved", tone: "error", icon: "alert-triangle" },
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
                {platform.LOCATIONS.map((l) => <Checkbox key={l.id} label={l.name} description={l.city} onChange={() => {}} checked={open.scope === "All locations" || open.scope.includes(l.name)} />)}
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
            <Select label="Location scope" hint="Location managers see only their locations." value="Al Quoz" options={["All locations", ...platform.LOCATIONS.map((l) => l.name)]} onChange={() => {}} />
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

export function SettingsScreen() {
  const [tab, setTab] = React.useState("general");
  const [toast, setToast] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [notif, setNotif] = React.useState({ exceptions: true, publish: true, ai: true, digest: false });
  const [revealed, setRevealed] = React.useState(false);
  const [rotate, setRotate] = React.useState<string | false>(false);
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
              <DefinitionList items={[
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
              <DefinitionList items={[
                { label: "order.created", value: <code>https://hooks.quotes.ae/qos/orders</code> },
                { label: "release.published", value: <code>https://hooks.quotes.ae/qos/releases</code> },
                { label: "Signing secret", value: <span style={{ display: "flex", gap: 8, alignItems: "center" }}><code>whsec_•••••••••••</code><Button size="sm" variant="ghost">Copy</Button></span> },
              ]} />
            </Card>
          </div>
        ) : null}

        {tab === "billing" ? (
          <div style={col}>
            <Grid cols={3}>
              <Card padding="sm"><div className="qos-kpi-label">Plan</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>Platform</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Annual · renews 1 Mar 2027</div></Card>
              <Card padding="sm"><div className="qos-kpi-label">Locations</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>12 <span style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 400 }}>of 15</span></div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>3 included seats unused</div></Card>
              <Card padding="sm"><div className="qos-kpi-label">Orders this month</div><div className="qos-kpi-value" style={{ fontSize: 22, lineHeight: "28px" }}>31,402</div><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Within the 50,000 allowance</div></Card>
            </Grid>
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

export function CustomersScreen() {
  const platform = usePlatformData();
  type Customer = typeof CUSTOMERS[number];
  const [open, setOpen] = React.useState<Customer | null>(null);
  const columns = [
    { key: "name", header: "Customer", render: (r: Customer) => <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={r.name} size="sm" /><span><span style={{ display: "block", fontWeight: 500 }}>{r.name}</span><span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>{r.phone}</span></span></span> },
    { key: "channel", header: "Usual channel" },
    { key: "orders", header: "Orders", numeric: true },
    { key: "spend", header: "Lifetime spend (AED)", numeric: true },
    { key: "last", header: "Last order", numeric: true },
    { key: "tags", header: "", render: (r: Customer) => <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>{r.tags.map((t) => <Badge key={t} tone={t === "New" ? "info" : "neutral"}>{t}</Badge>)}</span> },
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
            <DefinitionList items={[
              { label: "Usual channel", value: open.channel },
              { label: "Usual location", value: "Marina Walk" },
              { label: "Marketing consent", value: "Given · 12 Mar 2026" },
              { label: "First order", value: "18 Jan 2026" },
            ]} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Recent orders</div>
              <Timeline items={platform.ORDERS.slice(0, 3).map((o) => ({ title: <><span style={{ fontFamily: "var(--font-mono)" }}>{o.id}</span> · AED {o.amount}</>, meta: `${o.time} · ${o.channel} · ${o.location}`, tone: o.exception ? "error" : "success", icon: o.exception ? "alert-circle" : "check" }))} />
            </div>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
