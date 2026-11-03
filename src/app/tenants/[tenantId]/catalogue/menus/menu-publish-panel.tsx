"use client";

import { useCallback, useMemo, useState } from "react";

import {
  formatMenuPrice,
  menusCopy,
  type MenusCopyKey,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import { PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { Checkbox } from "@/design-system/components/primitives/Checkbox";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type LocationOption = {
  id: string;
  name: string;
};

type PublishPreviewTarget = {
  locationId: string;
  locationPublicId: string;
  locationName: string;
  currentSourceVersion: number | null;
  willChange: boolean;
  products: Array<{
    productPublicId: string;
    displayName: string;
    price: {
      amountMinor: number;
      currency: string;
      inheritanceMode: "inherited" | "override";
    };
  }>;
};

type MenuPublishPanelProps = {
  tenantId: string;
  menuPublicId: string;
  menuVersion: number;
  assignedLocationIds: string[];
  locations: LocationOption[];
};

const PUBLISH_STATUS_KEY: Record<string, MenusCopyKey> = {
  completed: "publishCompleted",
  partial: "publishPartial",
  failed: "publishFailed",
};

export function MenuPublishPanel({
  tenantId,
  menuPublicId,
  menuVersion,
  assignedLocationIds,
  locations,
}: MenuPublishPanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: MenusCopyKey, values?: Record<string, string | number>) =>
    menusCopy(locale, key, values);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [previewTargets, setPreviewTargets] = useState<PublishPreviewTarget[]>(
    [],
  );
  const [operationId, setOperationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assignedLocations = useMemo(
    () => locations.filter((location) => assignedLocationIds.includes(location.id)),
    [assignedLocationIds, locations],
  );

  const toggleLocation = useCallback((locationId: string) => {
    setSelectedLocationIds((current) =>
      current.includes(locationId)
        ? current.filter((value) => value !== locationId)
        : [...current, locationId],
    );
  }, []);

  const loadPreview = useCallback(async () => {
    if (selectedLocationIds.length === 0) {
      setError(menusCopy(locale, "selectAtLeastOneLocation"));
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const params = new URLSearchParams();
      for (const locationId of selectedLocationIds) {
        params.append("locationId", locationId);
      }

      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/publish-preview?${params.toString()}`,
      );
      const payload = (await response.json()) as {
        preview?: { targets: PublishPreviewTarget[] };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? menusCopy(locale, "unableToLoadPreview"));
      }

      setPreviewTargets(payload.preview?.targets ?? []);
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : menusCopy(locale, "unableToLoadPreview"),
      );
    } finally {
      setBusy(false);
    }
  }, [locale, menuPublicId, selectedLocationIds, tenantId]);

  const publishMenu = useCallback(async () => {
    if (selectedLocationIds.length === 0) {
      setError(menusCopy(locale, "selectAtLeastOneLocation"));
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            locationIds: selectedLocationIds,
            operationId: operationId.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json()) as {
        publish?: {
          operationId: string;
          status: string;
          results: Array<{
            locationPublicId: string;
            success: boolean;
            error?: string;
          }>;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? menusCopy(locale, "unableToPublish"));
      }

      const publish = payload.publish;
      if (!publish) {
        throw new Error(menusCopy(locale, "publishIncomplete"));
      }

      setOperationId(publish.operationId);

      const summary = publish.results
        .map((result) =>
          result.success
            ? menusCopy(locale, "publishResultPublished", { location: result.locationPublicId })
            : menusCopy(locale, "publishResultFailed", {
                location: result.locationPublicId,
                error: result.error ?? menusCopy(locale, "publishResultFailedFallback"),
              }),
        )
        .join(" · ");
      const statusKey = PUBLISH_STATUS_KEY[publish.status] ?? "publishCompleted";

      setMessage(`${menusCopy(locale, statusKey)} ${summary}`);
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : menusCopy(locale, "unableToPublish"),
      );
    } finally {
      setBusy(false);
    }
  }, [locale, menuPublicId, operationId, selectedLocationIds, tenantId]);

  return (
    <section className="qosp-editor-section qosp-glass" aria-labelledby="menu-publish-title">
      <h2 id="menu-publish-title" className="qosp-panel-title">
        {copy("publishTitle")}
      </h2>
      <p className="qosp-panel-help">{copy("publishHelp")}</p>

      <div className="qosp-panel-body qosp-stack">
        <fieldset className="qosp-choice-group">
          <legend className="qosp-field-label">{copy("publishTargets")}</legend>
          {assignedLocations.length > 0 ? (
            <div className="qosp-choice-row">
              {assignedLocations.map((location) => (
                <Checkbox
                  key={location.id}
                  label={location.name}
                  checked={selectedLocationIds.includes(location.id)}
                  onChange={() => toggleLocation(location.id)}
                />
              ))}
            </div>
          ) : (
            <p className="qosp-meta-line">{copy("noAssignedLocations")}</p>
          )}
        </fieldset>

        <div className="qosp-form-grid" data-columns="2">
          <PortalField label={copy("operationId")}>
            <input
              className="qos-input"
              dir="ltr"
              value={operationId}
              onChange={(event) => setOperationId(event.target.value)}
              placeholder={copy("operationIdPlaceholder")}
            />
          </PortalField>
          <p className="qosp-meta-line qosp-align-end">
            {copy("draftVersion", { version: menuVersion })}
          </p>
        </div>

        <div className="qosp-button-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadPreview()}
            className="qos-btn"
            data-variant="secondary"
          >
            {copy("previewTargets")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void publishMenu()}
            className="qos-btn"
            data-variant="primary"
          >
            {copy("publishToSelected")}
          </button>
        </div>

        {previewTargets.length > 0 ? (
          <div className="qosp-stack">
            {previewTargets.map((target) => (
              <article key={target.locationId} className="qosp-subcard">
                <h3 className="qosp-subcard-title">
                  {target.locationName}{" "}
                  <span className="qosp-code" dir="ltr">
                    {target.locationPublicId}
                  </span>
                </h3>
                <p className="qosp-meta-line qosp-preview-status">
                  {target.currentSourceVersion === null
                    ? copy("previewNotLive")
                    : copy("previewCurrentLive", { version: target.currentSourceVersion })}
                  {" · "}
                  {copy(target.willChange ? "previewWillUpdate" : "previewAlreadyCurrent")}
                </p>
                <ul className="qosp-preview-list">
                  {target.products.map((product) => (
                    <li key={product.productPublicId}>
                      <span>{product.displayName}</span>
                      <span className="qosp-preview-price">
                        {formatMenuPrice(locale, product.price.amountMinor, product.price.currency)}
                        <span className="qosp-meta-line">
                          {copy(
                            product.price.inheritanceMode === "override"
                              ? "priceOverride"
                              : "priceInherited",
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : null}

        {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
        {message ? <PortalNotice tone="success">{message}</PortalNotice> : null}
      </div>
    </section>
  );
}
