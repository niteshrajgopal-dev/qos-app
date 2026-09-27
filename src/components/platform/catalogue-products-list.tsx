"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PageHeader,
  Card,
  Button,
  DataTable,
  TableToolbar,
  Pagination,
  SearchInput,
  Tabs,
  Breadcrumbs,
  Icon,
  IconButton,
  StatusBadge,
  EmptyState,
  Alert,
} from "@/design-system";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ProductSummary = {
  publicId: string;
  internalName: string;
  displayName: string;
  status: string;
};

type ApiResponse = {
  products: ProductSummary[];
};

type LoadingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; products: ProductSummary[] };

export function CatalogueProductsList({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadingState>({ status: "loading" });
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    let cancelled = false;

    staffApiFetch(`/api/tenants/${tenantId}/catalogue/products`)
      .then(async (response) => {
        const body = (await response.json()) as
          | ApiResponse
          | { error?: string };

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setState({
            status: "error",
            message:
              ("error" in body && body.error) ||
              "Unable to load catalogue products.",
          });
          return;
        }

        if ("products" in body) {
          setState({ status: "success", products: body.products });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Network error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (state.status === "loading") {
    return (
      <>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
          }
          title="Products"
          subtitle="Loading products..."
        />
        <div style={{ marginTop: 20 }}>
          <Card>
            <p style={{ color: "var(--text-secondary)" }}>
              Loading catalogue products...
            </p>
          </Card>
        </div>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
          }
          title="Products"
        />
        <div style={{ marginTop: 20 }}>
          <Alert tone="error">{state.message}</Alert>
        </div>
      </>
    );
  }

  const allProducts = state.products;

  const filteredByTab =
    activeTab === "all"
      ? allProducts
      : allProducts.filter((p) => p.status === activeTab);

  const filteredBySearch = searchQuery
    ? filteredByTab.filter(
        (p) =>
          p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.internalName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : filteredByTab;

  const draftCount = allProducts.filter((p) => p.status === "draft").length;
  const activeCount = allProducts.filter((p) => p.status === "active").length;
  const archivedCount = allProducts.filter((p) => p.status === "archived")
    .length;

  const tabs = [
    { id: "all", label: "All", count: allProducts.length },
    { id: "active", label: "Active", count: activeCount },
    { id: "draft", label: "Drafts", count: draftCount },
    { id: "archived", label: "Archived", count: archivedCount },
  ];

  if (allProducts.length === 0) {
    return (
      <>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
          }
          title="Products"
          subtitle="No products yet"
          actions={
            <>
              <Button
                variant="secondary"
                icon="upload"
                onClick={() =>
                  router.push(`/tenants/${tenantId}/catalogue/import`)
                }
              >
                Import
              </Button>
              <Button
                icon="plus"
                onClick={() =>
                  router.push(`/tenants/${tenantId}/catalogue/products/new`)
                }
              >
                New product
              </Button>
            </>
          }
        />
        <div style={{ marginTop: 20 }}>
          <EmptyState
            icon="package"
            title="No catalogue products"
            body="Products you create or import will appear here."
            actions={
              <Button
                icon="plus"
                onClick={() =>
                  router.push(`/tenants/${tenantId}/catalogue/products/new`)
                }
              >
                New product
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const columns = [
    {
      key: "name",
      header: "Product",
      sortable: true,
      render: (r: ProductSummary) => (
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-sunken)",
              display: "grid",
              placeItems: "center",
              color: "var(--text-tertiary)",
            }}
          >
            <Icon name="image" size={13} />
          </span>
          <span style={{ fontWeight: 500 }}>{r.displayName}</span>
        </span>
      ),
    },
    {
      key: "internalName",
      header: "Internal name",
      render: (r: ProductSummary) => (
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {r.internalName}
        </span>
      ),
    },
    {
      key: "state",
      header: "Status",
      render: (r: ProductSummary) => <StatusBadge state={r.status} />,
    },
    {
      key: "act",
      header: "",
      width: 40,
      render: () => (
        <IconButton icon="more-horizontal" label="Actions" size="sm" />
      ),
    },
  ];

  const pageSize = 20;
  const totalProducts = filteredBySearch.length;
  const pageCount = Math.ceil(totalProducts / pageSize);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
        }
        title="Products"
        subtitle={`${totalProducts} product${totalProducts === 1 ? "" : "s"}`}
        actions={
          <>
            <Button
              variant="secondary"
              icon="upload"
              onClick={() =>
                router.push(`/tenants/${tenantId}/catalogue/import`)
              }
            >
              Import
            </Button>
            <Button
              icon="plus"
              onClick={() =>
                router.push(`/tenants/${tenantId}/catalogue/products/new`)
              }
            >
              New product
            </Button>
          </>
        }
        tabs={
          <Tabs
            tabs={tabs}
            value={activeTab}
            onChange={(tabId) => setActiveTab(tabId)}
          />
        }
      />
      <div style={{ marginTop: 20 }}>
        <Card padding="none">
          <TableToolbar>
            <SearchInput
              placeholder={`Search ${allProducts.length} products`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 240 }}
            />
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <IconButton
                icon="columns-3"
                label="Columns"
                variant="outline"
              />
              <IconButton icon="rows-3" label="Density" variant="outline" />
            </div>
          </TableToolbar>
          <DataTable
            columns={columns}
            rows={filteredBySearch}
            onRowClick={(r) =>
              router.push(
                `/tenants/${tenantId}/catalogue/products/${r.publicId}/edit`,
              )
            }
            sortKey="name"
          />
          {pageCount > 1 ? (
            <Pagination
              page={1}
              pageCount={pageCount}
              pageSize={pageSize}
              total={totalProducts}
            />
          ) : null}
        </Card>
      </div>
    </>
  );
}
