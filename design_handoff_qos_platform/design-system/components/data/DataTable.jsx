import React from "react";
import { Icon } from "../primitives/Icon.jsx";
import { Checkbox } from "../primitives/Checkbox.jsx";

/* Operational data grid. Columns: {key, header, numeric, width, render(row), sortable}.
   Exceptional rows are tinted via row.exception so problems outrank healthy rows. */
export function DataTable({
  columns = [],
  rows = [],
  density = "default",
  selectable = false,
  selectedIds = [],
  onToggleRow,
  onToggleAll,
  onRowClick,
  sortKey,
  sortDirection = "asc",
  onSort,
  rowKey = "id",
  ...rest
}) {
  const allSelected = selectable && rows.length > 0 && selectedIds.length === rows.length;
  return (
    <div className="qos-table-wrap" {...rest}>
      <table className="qos-table" data-density={density}>
        <thead>
          <tr>
            {selectable ? (
              <th style={{ width: 40 }}>
                <Checkbox checked={allSelected} indeterminate={selectedIds.length > 0 && !allSelected} onChange={() => onToggleAll && onToggleAll(!allSelected)} aria-label="Select all rows" />
              </th>
            ) : null}
            {columns.map((c) => (
              <th key={c.key} data-numeric={c.numeric || undefined} style={c.width ? { width: c.width } : undefined}>
                {c.sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort && onSort(c.key)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}
                  >
                    {c.header}
                    <Icon name={sortKey === c.key ? (sortDirection === "asc" ? "arrow-up" : "arrow-down") : "chevrons-up-down"} size={12} />
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = row[rowKey];
            const selected = selectedIds.includes(id);
            return (
              <tr
                key={id}
                data-selected={selected || undefined}
                data-exception={row.exception || undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {selectable ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected} onChange={() => onToggleRow && onToggleRow(id)} aria-label={`Select ${id}`} />
                  </td>
                ) : null}
                {columns.map((c) => (
                  <td key={c.key} data-numeric={c.numeric || undefined}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TableToolbar({ children, ...rest }) {
  return <div className="qos-table-toolbar" {...rest}>{children}</div>;
}

export function TableBulkBar({ count, children, ...rest }) {
  return (
    <div className="qos-table-bulk" {...rest}>
      <strong style={{ fontWeight: "var(--fw-semibold)" }}>{count} selected</strong>
      <div style={{ display: "flex", gap: "var(--space-2)", marginLeft: "auto" }}>{children}</div>
    </div>
  );
}
