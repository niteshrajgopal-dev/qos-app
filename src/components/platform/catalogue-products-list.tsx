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
  StatusBadge,
  EmptyState,
  Alert,
} from "@/design-system";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import {
  filterProducts,
  paginateProducts,
  formatSubtitle,
} from "./catalogue-products-filter";

export type ProductSummary = {
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
  const [currentPage, setCurrentPage] = useState(1);

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

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setCurrentPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

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
  const { filtered, counts } = filterProducts(
    allProducts,
    activeTab,
    searchQuery,
  );

  const tabs = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "draft", label: "Drafts", count: counts.draft },
    { id: "archived", label: "Archived", count: counts.archived },
  ];

  const hasSearchQuery = Boolean(searchQuery.trim());
  const noSearchResults = hasSearchQuery && filtered.length === 0;
  const emptyTab = !hasSearchQuery && filtered.length === 0 && counts.all > 0;

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

  const pageSize = 20;
  const totalProducts = filtered.length;
  const pageCount = Math.ceil(totalProducts / pageSize);
  const paginatedProducts = paginateProducts(filtered, currentPage, pageSize);

  if (noSearchResults) {
    return (
      <>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
          }
          title="Products"
          subtitle={formatSubtitle(
            filtered.length,
            activeTab,
            hasSearchQuery,
          )}
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
            <Tabs tabs={tabs} value={activeTab} onChange={handleTabChange} />
          }
        />
        <div style={{ marginTop: 20 }}>
          <Card padding="none">
            <TableToolbar>
              <SearchInput
                placeholder={`Search ${allProducts.length} products`}
                value={searchQuery}
                onChange={handleSearchChange}
                style={{ width: 240 }}
              />
            </TableToolbar>
            <div style={{ padding: "64px 24px", textAlign: "center" }}>
              <EmptyState
                icon="search"
                title="No products match your search"
                body={`No products found for "${searchQuery}".`}
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => setSearchQuery("")}
                  >
                    Clear search
                  </Button>
                }
              />
            </div>
          </Card>
        </div>
      </>
    );
  }

  if (emptyTab) {
    const emptyMessages = {
      active: {
        title: "No active products",
        body: "Active products will appear here once published.",
      },
      draft: {
        title: "No draft products",
        body: "Products you create or import will start as drafts.",
      },
      archived: {
        title: "No archived products",
        body: "Archived products will appear here.",
      },
    };

    const message =
      activeTab === "active" || activeTab === "draft" || activeTab === "archived"
        ? emptyMessages[activeTab]
        : { title: "No products", body: "No products to display." };

    return (
      <>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
          }
          title="Products"
          subtitle={formatSubtitle(
            filtered.length,
            activeTab,
            hasSearchQuery,
          )}
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
            <Tabs tabs={tabs} value={activeTab} onChange={handleTabChange} />
          }
        />
        <div style={{ marginTop: 20 }}>
          <Card>
            <EmptyState
              icon="package"
              title={message.title}
              body={message.body}
            />
          </Card>
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
  ];

  const subtitleText = formatSubtitle(
    totalProducts,
    activeTab,
    Boolean(searchQuery),
  );

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Catalogue" }, { label: "Products" }]} />
        }
        title="Products"
        subtitle={subtitleText}
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
          <Tabs tabs={tabs} value={activeTab} onChange={handleTabChange} />
        }
      />
      <div style={{ marginTop: 20 }}>
        <Card padding="none">
          <TableToolbar>
            <SearchInput
              placeholder={`Search ${allProducts.length} products`}
              value={searchQuery}
              onChange={handleSearchChange}
              style={{ width: 240 }}
            />
          </TableToolbar>
          <DataTable
            columns={columns}
            rows={paginatedProducts}
            onRowClick={(r) =>
              router.push(
                `/tenants/${tenantId}/catalogue/products/${r.publicId}/edit`,
              )
            }
            sortKey="name"
          />
          {pageCount > 1 ? (
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              total={totalProducts}
              onPageChange={setCurrentPage}
            />
          ) : null}
        </Card>
      </div>
    </>
  );
}
