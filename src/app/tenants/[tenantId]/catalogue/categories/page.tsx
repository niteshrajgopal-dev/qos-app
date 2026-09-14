"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StaffScreen } from "@/components/staff/StaffScreen";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type CategorySummary = {
  publicId: string;
  internalName: string;
  sortOrder: number;
  version: number;
  status: "active" | "archived";
  productCount: number;
  translations: {
    en: { displayName: string };
    ar: { displayName: string };
  };
};

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default function TenantCategoriesPage({ params }: PageProps) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ tenantId: resolvedTenantId }) => {
      setTenantId(resolvedTenantId);
    });
  }, [params]);

  const loadCategories = useCallback(async () => {
    if (!tenantId) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories`,
      );
      const payload = (await response.json()) as {
        categories?: CategorySummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load categories.");
      }

      setCategories(payload.categories ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load categories.",
      );
    } finally {
      setBusy(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadCategories();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadCategories, tenantId]);

  async function createCategory() {
    if (!tenantId) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories`,
        {
          method: "POST",
          body: JSON.stringify({
            internalName: "new-category",
            translations: {
              en: { displayName: "New category" },
              ar: { displayName: "تصنيف جديد" },
            },
          }),
        },
      );
      const payload = (await response.json()) as {
        category?: { publicId: string };
        error?: string;
      };

      if (!response.ok || !payload.category) {
        throw new Error(payload.error ?? "Unable to create category.");
      }

      window.location.href = `/tenants/${tenantId}/catalogue/categories/${payload.category.publicId}/edit`;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create category.",
      );
      setBusy(false);
    }
  }

  async function moveCategory(publicId: string, direction: -1 | 1) {
    if (!tenantId) {
      return;
    }

    const index = categories.findIndex((category) => category.publicId === publicId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= categories.length) {
      return;
    }

    const orderedPublicIds = categories.map((category) => category.publicId);
    const [moved] = orderedPublicIds.splice(index, 1);
    orderedPublicIds.splice(nextIndex, 0, moved);

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories/reorder`,
        {
          method: "POST",
          body: JSON.stringify({ orderedPublicIds }),
        },
      );
      const payload = (await response.json()) as {
        categories?: CategorySummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reorder categories.");
      }

      setCategories(payload.categories ?? []);
    } catch (reorderError) {
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : "Unable to reorder categories.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!tenantId) {
    return null;
  }

  return (
    <StaffScreen
      title="Categories"
      subtitle="Group products for staff merchandising. Published menus still use menu sections."
      actions={
        <button
          type="button"
          disabled={busy}
          onClick={() => void createCategory()}
          className="qos-btn"
          data-variant="primary"
        >
          New category
        </button>
      }
    >
      {error ? (
        <div className="qos-alert" data-tone="error" role="alert">
          <div className="qos-alert-body">{error}</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {categories.map((category, index) => (
          <div
            key={category.publicId}
            className="qos-card"
            data-padding="sm"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              alignItems: "center",
            }}
          >
            <Link
              href={`/tenants/${tenantId}/catalogue/categories/${category.publicId}/edit`}
              style={{ flex: 1, minWidth: 0 }}
            >
              <strong>
                {category.translations.en.displayName || category.internalName}
              </strong>
              <p className="qos-card-sub">
                {category.publicId} · {category.productCount} product(s) ·{" "}
                {category.status}
              </p>
            </Link>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="qos-btn"
                data-variant="ghost"
                disabled={busy || index === 0}
                onClick={() => void moveCategory(category.publicId, -1)}
              >
                Up
              </button>
              <button
                type="button"
                className="qos-btn"
                data-variant="ghost"
                disabled={busy || index === categories.length - 1}
                onClick={() => void moveCategory(category.publicId, 1)}
              >
                Down
              </button>
            </div>
          </div>
        ))}
        {!busy && categories.length === 0 ? (
          <p className="qos-pagesub">No categories yet.</p>
        ) : null}
      </div>
    </StaffScreen>
  );
}
