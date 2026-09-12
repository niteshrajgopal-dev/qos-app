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
