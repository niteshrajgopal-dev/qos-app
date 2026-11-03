"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Package, Plus, Upload } from "lucide-react";

import { Button } from "@/design-system";
import {
  PortalArea,
  PortalBadge,
  PortalFilterTabs,
  PortalNotice,
  PortalPageHeader,
  PortalPagination,
  PortalPanel,
  PortalSearchField,
  PortalStat,
  PortalStatGrid,
  PortalToolbar,
  type PortalBadgeTone,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import {
  staffNavLabel,
  staffProductsListSubtitle,
  staffProductsSearchEmptyBody,
  staffProductsSearchPlaceholder,
  staffUiCopy,
  type StaffLocale,
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

export function productStatusBadge(
  locale: StaffLocale,
  status: string,
): { tone: PortalBadgeTone; label: string } {
  if (status === "active") {
    return { tone: "positive", label: staffUiCopy(locale, "productEditorStatusActive") };
  }
  if (status === "archived") {
    return { tone: "neutral", label: staffUiCopy(locale, "productEditorStatusArchived") };
  }
  return { tone: "warm", label: staffUiCopy(locale, "productEditorStatusDraft") };
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

const PAGE_SIZE = 24;
const RESULTS_ID = "catalogue-products-results";

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

  const newProductHref = `/tenants/${tenantId}/catalogue/products/new`;
  const header = (
    <PortalPageHeader
      title={staffUiCopy(locale, "catalogueHeadline")}
      description={staffUiCopy(locale, "catalogueDescription")}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => router.push(`/tenants/${tenantId}/catalogue/import`)}
          >
            <Upload size={16} aria-hidden="true" />
            {staffNavLabel(locale, "import", "Import")}
          </Button>
          <Button onClick={() => router.push(newProductHref)}>
            <Plus size={16} aria-hidden="true" />
            {staffUiCopy(locale, "newProduct")}
          </Button>
        </>
      }
    />
  );

  const managementPanel = (
    <PortalPanel className="qosp-catalogue-management">
      <h2>{staffUiCopy(locale, "catalogueManagement")}</h2>
      <ul className="qosp-link-list">
        {(
          [
            ["menus", "/catalogue/menus"],
            ["modifiers", "/catalogue/modifier-groups"],
            ["categories", "/catalogue/categories"],
          ] as const
        ).map(([key, suffix]) => (
          <li key={key}>
            <Link className="qosp-text-link" href={`/tenants/${tenantId}${suffix}`}>
              {staffUiCopy(locale, key)}
              <ArrowUpRight size={15} aria-hidden="true" className="qosp-flip-rtl" />
            </Link>
          </li>
        ))}
      </ul>
    </PortalPanel>
  );

  if (state.status === "loading") {
    return (
      <PortalArea>
        {header}
        <PortalPanel>
          <p className="qosp-meta-line" role="status">
            {staffUiCopy(locale, "loadingCatalogueProducts")}
          </p>
        </PortalPanel>
      </PortalArea>
    );
  }

  if (state.status === "error") {
    return (
      <PortalArea>
        {header}
        <PortalNotice tone="error">{state.message}</PortalNotice>
      </PortalArea>
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

  const isArchivedTab = activeTab === "archived";
  const hasSearchQuery = Boolean(searchQuery.trim());
  const noSearchResults = hasSearchQuery && filtered.length === 0;
  const catalogueIsEmpty =
    activeProducts.length === 0 && archivedProducts.length === 0;

  const tabs = [
    { id: "all", label: staffUiCopy(locale, "tabAll"), count: counts.all },
    { id: "active", label: staffUiCopy(locale, "tabActive"), count: counts.active },
    { id: "draft", label: staffUiCopy(locale, "tabDrafts"), count: counts.draft },
    { id: "archived", label: staffUiCopy(locale, "tabArchived"), count: counts.archived },
  ];

  const emptyTabMessages: Record<string, { title: string; body: string }> = {
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
  const emptyTabMessage = emptyTabMessages[activeTab] ?? {
    title: staffUiCopy(locale, "noProductsTitle"),
    body: staffUiCopy(locale, "noProductsBody"),
  };

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(currentPage, pageCount);
  const pageProducts = paginateProducts(filtered, page, PAGE_SIZE);

  let results: React.ReactNode;
  if (catalogueIsEmpty) {
    results = (
      <PortalPanel className="qosp-empty-panel">
        <Package size={36} strokeWidth={1.2} aria-hidden="true" />
        <h2>{staffUiCopy(locale, "noCatalogueProductsTitle")}</h2>
        <p>{staffUiCopy(locale, "noCatalogueProductsBody")}</p>
        <Button onClick={() => router.push(newProductHref)}>
          <Plus size={16} aria-hidden="true" />
          {staffUiCopy(locale, "newProduct")}
        </Button>
      </PortalPanel>
    );
  } else if (noSearchResults) {
    results = (
      <PortalPanel className="qosp-empty-panel">
        <h2>{staffUiCopy(locale, "noProductsMatchSearch")}</h2>
        <p>{staffProductsSearchEmptyBody(locale, searchQuery)}</p>
        <Button variant="secondary" onClick={() => setSearchQuery("")}>
          {staffUiCopy(locale, "clearSearch")}
        </Button>
      </PortalPanel>
    );
  } else if (filtered.length === 0) {
    results = (
      <PortalPanel className="qosp-empty-panel">
        <Package size={36} strokeWidth={1.2} aria-hidden="true" />
        <h2>{emptyTabMessage.title}</h2>
        <p>{emptyTabMessage.body}</p>
      </PortalPanel>
    );
  } else {
    results = (
      <>
        <ul className="qosp-product-grid">
          {pageProducts.map((product) => {
            const badge = productStatusBadge(locale, product.status);
            return (
              <li key={product.publicId} className="qosp-product-card qosp-glass">
                <div className="qosp-product-visual">
                  {product.thumbnailPublicId ? (
                    <Image
                      src={publicProductThumbnailUrl(product.thumbnailPublicId)}
                      alt=""
                      fill
                      sizes="(max-width: 680px) 50vw, 320px"
                      unoptimized
                    />
                  ) : (
                    <span className="qosp-product-visual-empty">
                      <Package size={40} strokeWidth={1} aria-hidden="true" />
                      {staffUiCopy(locale, "productNoPhoto")}
                    </span>
                  )}
                  <span className="qosp-product-arrow" aria-hidden="true">
                    <ArrowUpRight size={15} className="qosp-flip-rtl" />
                  </span>
                </div>
                <div className="qosp-product-info">
                  <span className="qosp-product-meta">{product.internalName}</span>
                  <h2 className="qosp-product-name">
                    <Link
                      className="qosp-product-link"
                      href={`/tenants/${tenantId}/catalogue/products/${product.publicId}/edit`}
                    >
                      {product.displayName || product.internalName}
                    </Link>
                  </h2>
                  <div className="qosp-product-foot">
                    <PortalBadge tone={badge.tone}>{badge.label}</PortalBadge>
                    {isArchivedTab ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={restoringId === product.publicId}
                        onClick={() => void restoreArchivedProduct(product.publicId)}
                      >
                        {restoringId === product.publicId
                          ? staffUiCopy(locale, "restoring")
                          : staffUiCopy(locale, "restoreToDraft")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {pageCount > 1 ? (
          <PortalPagination
            page={page}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPageChange={setCurrentPage}
          />
        ) : null}
      </>
    );
  }

  return (
    <PortalArea>
      {header}
      <div className="qosp-stack">
        {showArchivedNotice ? (
          <PortalNotice tone="success">
            {staffUiCopy(locale, "archiveDraftProductSuccessNotice")}
          </PortalNotice>
        ) : null}
        {restoreError ? <PortalNotice tone="error">{restoreError}</PortalNotice> : null}
      </div>

      <PortalStatGrid>
        <PortalStat
          label={staffUiCopy(locale, "productsTitle")}
          value={String(counts.all)}
          sub={staffUiCopy(locale, "catalogueStatProductsSub")}
        />
        <PortalStat
          label={staffUiCopy(locale, "catalogueStatActiveLabel")}
          value={String(counts.active)}
          sub={staffUiCopy(locale, "catalogueStatActiveSub")}
        />
        <PortalStat
          label={staffUiCopy(locale, "catalogueStatDraftsLabel")}
          value={String(counts.draft)}
          sub={staffUiCopy(locale, "catalogueStatDraftsSub")}
        />
      </PortalStatGrid>

      {catalogueIsEmpty ? null : (
        <PortalToolbar>
          <PortalFilterTabs
            label={staffUiCopy(locale, "catalogueFilterLabel")}
            tabs={tabs}
            value={activeTab}
            onChange={handleTabChange}
            controls={RESULTS_ID}
          />
          <PortalSearchField
            label={staffUiCopy(locale, "catalogueSearchLabel")}
            placeholder={staffProductsSearchPlaceholder(
              locale,
              isArchivedTab ? archivedProducts.length : activeProducts.length,
            )}
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </PortalToolbar>
      )}

      <section id={RESULTS_ID} aria-label={staffUiCopy(locale, "catalogueResultsLabel")}>
        {catalogueIsEmpty ? null : (
          <p className="qosp-meta-line qosp-results-summary" aria-live="polite">
            {staffProductsListSubtitle(locale, filtered.length, activeTab, hasSearchQuery)}
          </p>
        )}
        {results}
      </section>

      {managementPanel}
    </PortalArea>
  );
}
