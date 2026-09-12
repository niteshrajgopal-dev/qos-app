import * as React from "react";

export interface DataTableProps {
  columns?: Array<{ key: string; header: React.ReactNode; numeric?: boolean; width?: number | string; sortable?: boolean; render?: (row: any) => React.ReactNode }>;
  rows?: any[];
  density?: "default" | "dense";
  selectable?: boolean;
  selectedIds?: Array<string | number>;
  onToggleRow?: (id: string | number) => void;
  onToggleAll?: (next: boolean) => void;
  onRowClick?: (row: any) => void;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  rowKey?: string;
}

export declare function DataTable(props: DataTableProps): JSX.Element;

export interface TableToolbarProps {
  children?: React.ReactNode;
}

export declare function TableToolbar(props: TableToolbarProps): JSX.Element;

export interface TableBulkBarProps {
  count: number;
  children?: React.ReactNode;
}

export declare function TableBulkBar(props: TableBulkBarProps): JSX.Element;
