"use client";

import { useCallback, useEffect, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type CategoryEditorProps = {
  tenantId: string;
  categoryPublicId: string;
};

type CategoryState = {
  publicId: string;
  internalName: string;
  sortOrder: number;
  version: number;
  status: "active" | "archived";
  translations: {
    en: { displayName: string };
    ar: { displayName: string };
  };
  products: Array<{
    productPublicId: string;
    internalName: string;
    displayName: string;
  }>;
};

export function CategoryEditor({
  tenantId,
  categoryPublicId,
}: CategoryEditorProps) {
  const [category, setCategory] = useState<CategoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [productPublicId, setProductPublicId] = useState("");

  const loadCategory = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories/${categoryPublicId}`,
      );
      const payload = (await response.json()) as {
        category?: CategoryState;
        error?: string;
      };

      if (!response.ok || !payload.category) {
        throw new Error(payload.error ?? "Unable to load category.");
      }

      setCategory(payload.category);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load category.",
      );
    } finally {
      setBusy(false);
    }
  }, [categoryPublicId, tenantId]);

  useEffect(() => {
    void loadCategory();
  }, [loadCategory]);

  async function saveCategory() {
    if (!category) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories/${categoryPublicId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: category.version,
            internalName: category.internalName,
            status: category.status,
            translations: category.translations,
          }),
        },
      );
      const payload = (await response.json()) as {
        category?: CategoryState;
        error?: string;
      };

      if (!response.ok || !payload.category) {
        throw new Error(payload.error ?? "Unable to save category.");
      }

      setCategory(payload.category);
      setMessage("Saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save category.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function assignProduct() {
    if (!productPublicId.trim()) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories/${categoryPublicId}/products`,
        {
          method: "POST",
          body: JSON.stringify({ productPublicId: productPublicId.trim() }),
        },
      );
      const payload = (await response.json()) as {
        category?: CategoryState;
        error?: string;
      };

      if (!response.ok || !payload.category) {
        throw new Error(payload.error ?? "Unable to assign product.");
      }

      setCategory(payload.category);
      setProductPublicId("");
      setMessage("Product assigned.");
    } catch (assignError) {
      setError(
        assignError instanceof Error
          ? assignError.message
          : "Unable to assign product.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function unassignProduct(assignedProductPublicId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/categories/${categoryPublicId}/products/${assignedProductPublicId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        category?: CategoryState;
        error?: string;
      };

      if (!response.ok || !payload.category) {
        throw new Error(payload.error ?? "Unable to remove product.");
      }

      setCategory(payload.category);
      setMessage("Product removed.");
    } catch (unassignError) {
      setError(
        unassignError instanceof Error
          ? unassignError.message
          : "Unable to remove product.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!category) {
    return error ? (
      <div className="qos-alert" data-tone="error" role="alert">
        <div className="qos-alert-body">{error}</div>
      </div>
    ) : (
      <p className="qos-pagesub">Loading category…</p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error ? (
        <div className="qos-alert" data-tone="error" role="alert">
          <div className="qos-alert-body">{error}</div>
        </div>
      ) : null}
      {message ? (
        <div className="qos-alert" data-tone="success" role="status">
          <div className="qos-alert-body">{message}</div>
        </div>
      ) : null}

      <label className="qos-field">
        <span className="qos-label">Internal name</span>
        <input
          className="qos-input"
          value={category.internalName}
          onChange={(event) =>
            setCategory({ ...category, internalName: event.target.value })
          }
        />
      </label>
      <label className="qos-field">
        <span className="qos-label">English name</span>
        <input
          className="qos-input"
          value={category.translations.en.displayName}
          onChange={(event) =>
            setCategory({
              ...category,
              translations: {
                ...category.translations,
                en: { displayName: event.target.value },
              },
            })
          }
        />
      </label>
      <label className="qos-field">
        <span className="qos-label">Arabic name</span>
        <input
          className="qos-input"
          dir="rtl"
          value={category.translations.ar.displayName}
          onChange={(event) =>
            setCategory({
              ...category,
              translations: {
                ...category.translations,
                ar: { displayName: event.target.value },
              },
            })
          }
        />
      </label>
      <label className="qos-field">
        <span className="qos-label">Status</span>
        <select
          className="qos-input"
          value={category.status}
          onChange={(event) =>
            setCategory({
              ...category,
              status: event.target.value === "archived" ? "archived" : "active",
            })
          }
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <button
        type="button"
        className="qos-btn"
        data-variant="primary"
        disabled={busy}
        onClick={() => void saveCategory()}
      >
        Save category
      </button>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 className="qos-pagetitle" style={{ fontSize: "1.1rem" }}>
          Assigned products
        </h2>
        <p className="qos-pagesub">
          Categories label products for staff. They do not replace published menu
          sections.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="qos-input"
            placeholder="prd_…"
            value={productPublicId}
            onChange={(event) => setProductPublicId(event.target.value)}
          />
          <button
            type="button"
            className="qos-btn"
            disabled={busy}
            onClick={() => void assignProduct()}
          >
            Assign
          </button>
        </div>
        {category.products.map((product) => (
          <div
            key={product.productPublicId}
            className="qos-card"
            data-padding="sm"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div>
              <strong>{product.displayName}</strong>
              <p className="qos-card-sub">{product.productPublicId}</p>
            </div>
            <button
              type="button"
              className="qos-btn"
              data-variant="ghost"
              disabled={busy}
              onClick={() => void unassignProduct(product.productPublicId)}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
