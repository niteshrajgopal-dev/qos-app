# DataTable

The operational data grid — orders, products, locations, releases.

```jsx
<DataTable columns={cols} rows={rows} selectable selectedIds={ids} onToggleRow={toggle} />
```

Set `row.exception = true` to tint problem rows so they outrank healthy ones. Pair with `TableToolbar` (search + filters), `TableBulkBar` (selection actions) and `Pagination`.
