"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

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
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import {
  staffNavLabel,
  staffProductsListSubtitle,
  staffProductsSearchEmptyBody,
  staffProductsSearchPlaceholder,
  staffUiCopy,
} from "@/lib/staff/locale";
import {
  filterProducts,
  paginateProducts,
} from "./catalogue-products-filter";

export type ProductSummary = {
  publicId: string;
  internalName: string;
  displayName: string;
  status: string;
  thumbnailPublicId: string | null;
};

export function publicProductThumbnailUrl(thumbnailPublicId: string) {
  return `/api/public/media/${thumbnailPublicId}`;
}

type ApiResponse = {
  products: ProductSummary[];
  archivedProducts?: ProductSummary[];
};

type LoadingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      products: ProductSummary[];
      archivedProducts: ProductSummary[];
    };

export function CatalogueProductsList({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useStaffLocale();
  const [state, setState] = useState<LoadingState>({ status: "loading" });
  const showArchivedNotice = searchParams.get("productArchived") === "1";
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const breadcrumbItems = useMemo(
    () => [
      { label: staffUiCopy(locale, "catalogue") },
      { label: staffUiCopy(locale, "productsTitle") },
    ],
    [locale],
  );

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
              staffUiCopy(locale, "unableToLoadCatalogueProducts"),
          });
          return;
        }

        if ("products" in body) {
          setState({
            status: "success",
            products: body.products,
            archivedProducts: body.archivedProducts ?? [],
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : staffUiCopy(locale, "networkError"),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, locale]);

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
          breadcrumbs={<Breadcrumbs items={breadcrumbItems} />}
          title={staffUiCopy(locale, "productsTitle")}
          subtitle={staffUiCopy(locale, "loadingProductsSubtitle")}
        />
        <div style={{ marginTop: 20 }}>
          <Card>
            <p style={{ color: "var(--text-secondary)" }}>
              {staffUiCopy(locale, "loadingCatalogueProducts")}
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
          breadcrumbs={<Breadcrumbs items={breadcrumbItems} />}
          title={staffUiCopy(locale, "productsTitle")}
        />
        <div style={{ marginTop: 20 }}>
          <Alert tone="error">{state.message}</Alert>
        </div>
      </>
    );
  }

  const activeProducts = state.products;
  const archivedProducts = state.archivedProducts;
  const { filtered, counts } = filterProducts(
    activeProducts,
    archivedProducts,
    activeTab,
    searchQuery,
  );

  async function restoreArchivedProduct(publicId: string) {
    setRestoringId(publicId);
    setRestoreError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${publicId}/restore`,
        { method: "POST" },
      );
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          body.error ?? staffUiCopy(locale, "unableToRestoreProduct"),
        );
      }

      setState((current) => {
        if (current.status !== "success") {
          return current;
        }

        const restored = current.archivedProducts.find(
          (product) => product.publicId === publicId,
        );
        if (!restored) {
          return current;
        }

        return {
          status: "success",
          products: [
            ...current.products,
            { ...restored, status: "draft" },
          ].sort((a, b) => a.publicId.localeCompare(b.publicId)),
          archivedProducts: current.archivedProducts.filter(
            (product) => product.publicId !== publicId,
          ),
        };
      });
    } catch (error) {
      setRestoreError(
        error instanceof Error
          ? error.message
          : staffUiCopy(locale, "unableToRestoreProduct"),
      );
    } finally {
      setRestoringId(null);
    }
  }

  const tabs = [
    { id: "all", label: staffUiCopy(locale, "tabAll"), count: counts.all },
    {
      id: "active",
      label: staffUiCopy(locale, "tabActive"),
      count: counts.active,
    },
    {
      id: "draft",
      label: staffUiCopy(locale, "tabDrafts"),
      count: counts.draft,
    },
    {
      id: "archived",
      label: staffUiCopy(locale, "tabArchived"),
      count: counts.archived,
    },
  ];

  const listActions = (
    <>
      <Button
        variant="secondary"
        icon="upload"
        onClick={() => router.push(`/tenants/${tenantId}/catalogue/import`)}
      >
        {staffNavLabel(locale, "import", "Import")}
      </Button>
      <Button
        icon="plus"
        onClick={() =>
          router.push(`/tenants/${tenantId}/catalogue/products/new`)
        }
      >
        {staffUiCopy(locale, "newProduct")}
      </Button>
    </>
  );

  const hasSearchQuery = Boolean(searchQuery.trim());
  const noSearchResults = hasSearchQuery && filtered.length === 0;
  const emptyTab =
    !hasSearchQuery &&
    filtered.length === 0 &&
    (counts.all > 0 || counts.archived > 0);

  if (activeProducts.length === 0 && archivedProducts.length === 0) {
    return (
      <>
        <PageHeader
          breadcrumbs={<Breadcrumbs items={breadcrumbItems} />}
          title={staffUiCopy(locale, "productsTitle")}
          subtitle={staffUiCopy(locale, "noProductsYet")}
          actions={listActions}
        />
        <div style={{ marginTop: 20 }}>
          <EmptyState
            icon="package"
            title={staffUiCopy(locale, "noCatalogueProductsTitle")}
            body={staffUiCopy(locale, "noCatalogueProductsBody")}
            actions={
              <Button
                icon="plus"
                onClick={() =>
                  router.push(`/tenants/${tenantId}/catalogue/products/new`)
                }
              >
                {staffUiCopy(locale, "newProduct")}
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
          breadcrumbs={<Breadcrumbs items={breadcrumbItems} />}
          title={staffUiCopy(locale, "productsTitle")}
          subtitle={staffProductsListSubtitle(
            locale,
            filtered.length,
            activeTab,
            hasSearchQuery,
          )}
          actions={listActions}
          tabs={
            <Tabs tabs={tabs} value={activeTab} onChange={handleTabChange} />
          }
        />
        <div style={{ marginTop: 20 }}>
          <Card padding="none">
            <TableToolbar>
              <SearchInput
                placeholder={staffProductsSearchPlaceholder(
                  locale,
                  activeProducts.length,
                )}
                value={searchQuery}
                onChange={handleSearchChange}
                style={{ width: 240 }}
              />
            </TableToolbar>
            <div style={{ padding: "64px 24px", textAlign: "center" }}>
              <EmptyState
                icon="search"
                title={staffUiCopy(locale, "noProductsMatchSearch")}
                body={staffProductsSearchEmptyBody(locale, searchQuery)}
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => setSearchQuery("")}
                  >
                    {staffUiCopy(locale, "clearSearch")}
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
        title: staffUiCopy(locale, "noActiveProductsTitle"),
        body: staffUiCopy(locale, "noActiveProductsBody"),
      },
      draft: {
        title: staffUiCopy(locale, "noDraftProductsTitle"),
        body: staffUiCopy(locale, "noDraftProductsBody"),
      },
      archived: {
        title: staffUiCopy(locale, "noArchivedProductsTitle"),
        body: staffUiCopy(locale, "noArchivedProductsBody"),
      },
    };

    const message =
      activeTab === "active" || activeTab === "draft" || activeTab === "archived"
        ? emptyMessages[activeTab]
        : {
            title: staffUiCopy(locale, "noProductsTitle"),
            body: staffUiCopy(locale, "noProductsBody"),
          };

    return (
      <>
        <PageHeader
          breadcrumbs={<Breadcrumbs items={breadcrumbItems} />}
          title={staffUiCopy(locale, "productsTitle")}
          subtitle={staffProductsListSubtitle(
            locale,
            filtered.length,
            activeTab,
            hasSearchQuery,
          )}
          actions={listActions}
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

  const isArchivedTab = activeTab === "archived";

  const columns = [
    {
      key: "name",
      header: staffUiCopy(locale, "columnProduct"),
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
              overflow: "hidden",
              flex: "none",
            }}
          >
            {r.thumbnailPublicId ? (
              <Image
                src={publicProductThumbnailUrl(r.thumbnailPublicId)}
                alt=""
                width={28}
                height={28}
                unoptimized
                style={{ width: 28, height: 28, objectFit: "cover", display: "block" }}
              />
            ) : (
              <Icon name="image" size={13} />
            )}
          </span>
          <span style={{ fontWeight: 500 }}>{r.displayName}</span>
        </span>
      ),
    },
    {
      key: "internalName",
      header: staffUiCopy(locale, "columnInternalName"),
      render: (r: ProductSummary) => (
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {r.internalName}
        </span>
      ),
    },
    {
      key: "state",
      header: staffUiCopy(locale, "columnStatus"),
      render: (r: ProductSummary) => <StatusBadge state={r.status} />,
    },
    ...(isArchivedTab
      ? [
          {
            key: "restore",
            header: staffUiCopy(locale, "columnActions"),
            render: (r: ProductSummary) => (
              <Button
                variant="secondary"
                size="sm"
                disabled={restoringId === r.publicId}
                onClick={(event) => {
                  event.stopPropagation();
                  void restoreArchivedProduct(r.publicId);
                }}
              >
                {restoringId === r.publicId
                  ? staffUiCopy(locale, "restoring")
                  : staffUiCopy(locale, "restoreToDraft")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const subtitleText = staffProductsListSubtitle(
    locale,
    totalProducts,
    activeTab,
    Boolean(searchQuery),
  );

  return (
    <>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={breadcrumbItems} />}
        title={staffUiCopy(locale, "productsTitle")}
        subtitle={subtitleText}
        actions={listActions}
        tabs={<Tabs tabs={tabs} value={activeTab} onChange={handleTabChange} />}
      />
      {showArchivedNotice ? (
        <div style={{ marginTop: 20 }}>
          <Alert tone="success">
            {staffUiCopy(locale, "archiveDraftProductSuccessNotice")}
          </Alert>
        </div>
      ) : null}
      {restoreError ? (
        <div style={{ marginTop: 20 }}>
          <Alert tone="error">{restoreError}</Alert>
        </div>
      ) : null}
      <div style={{ marginTop: 20 }}>
        <Card padding="none">
          <TableToolbar>
            <SearchInput
              placeholder={staffProductsSearchPlaceholder(
                locale,
                isArchivedTab ? archivedProducts.length : activeProducts.length,
              )}
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
