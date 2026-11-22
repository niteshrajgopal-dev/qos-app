"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ArrowUpRight } from "lucide-react";

import {
  PortalField,
  PortalNotice,
} from "@/components/portal/workspace/PortalWorkspace";
import { ProductModifierAssignmentPolicyEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-modifier-assignment-policy-editor";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { AssignmentPolicyPatchBody } from "@/lib/catalogue/modifier-assignment-policy-ui";
import type { ProductModifierGroupAssignmentView } from "@/lib/catalogue/modifiers";
import type { CatalogueProductEditorStatus } from "@/lib/catalogue/product-editor-copy";
import { productEditorChildMutationsDisabled } from "@/lib/catalogue/product-editor-mutation-ui";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

type ProductModifierGroupsPanelProps = {
  tenantId: string;
  productPublicId: string;
  productStatus: CatalogueProductEditorStatus;
};

type AvailableGroup = {
  publicId: string;
  internalName: string;
  translations: { en: { displayName: string } };
};

type ProductModifierView = {
  productVersion: number;
  modifierGroups: ProductModifierGroupAssignmentView[];
};

export function ProductModifierGroupsPanel({
  tenantId,
  productPublicId,
  productStatus,
}: ProductModifierGroupsPanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  const mutationsDisabled = productEditorChildMutationsDisabled(productStatus);
  const [view, setView] = useState<ProductModifierView | null>(null);
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([]);
  const [selectedGroupPublicId, setSelectedGroupPublicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const [productResponse, groupsResponse] = await Promise.all([
        staffApiFetch(
          `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups`,
        ),
        staffApiFetch(`/api/tenants/${tenantId}/catalogue/modifier-groups`),
      ]);

      const productPayload = (await productResponse.json()) as ProductModifierView & {
        error?: string;
      };
      const groupsPayload = (await groupsResponse.json()) as {
        groups?: AvailableGroup[];
        error?: string;
      };

      if (!productResponse.ok) {
        throw new Error(productPayload.error ?? staffUiCopy(locale, "modifierLoadError"));
      }

      if (!groupsResponse.ok) {
        throw new Error(groupsPayload.error ?? staffUiCopy(locale, "modifierLoadError"));
      }

      setView(productPayload);
      setAvailableGroups(groupsPayload.groups ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : staffUiCopy(locale, "modifierLoadError"),
      );
    } finally {
      setBusy(false);
    }
  }, [locale, productPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function attachGroup() {
    if (!view || !selectedGroupPublicId) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            modifierGroupPublicId: selectedGroupPublicId,
          }),
        },
      );
      const payload = (await response.json()) as ProductModifierView & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? copy("modifierAttachError"));
      }

      setView(payload);
      setSelectedGroupPublicId("");
      setMessage(copy("modifierAttached"));
    } catch (attachError) {
      setError(
        attachError instanceof Error
          ? attachError.message
          : copy("modifierAttachError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function detachGroup(groupPublicId: string) {
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups/${groupPublicId}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
          }),
        },
      );
      const payload = (await response.json()) as ProductModifierView & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? copy("modifierDetachError"));
      }

      setView(payload);
      setMessage(copy("modifierDetached"));
    } catch (detachError) {
      setError(
        detachError instanceof Error
          ? detachError.message
          : copy("modifierDetachError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(
    groupPublicId: string,
    body: AssignmentPolicyPatchBody,
    successKey: StaffUiCopyKey,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups/${groupPublicId}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as ProductModifierView & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? copy("modifierPolicySaveError"));
      }

      setView(payload);
      setMessage(copy(successKey));
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : copy("modifierPolicySaveError"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unattachedGroups = availableGroups.filter(
    (group) =>
      !view?.modifierGroups.some(
        (assigned) => assigned.modifierGroupPublicId === group.publicId,
      ),
  );

  return (
    <div className="qosp-stack">
      <div className="qosp-button-row" data-align="end">
        <Link href={`/tenants/${tenantId}/catalogue/modifier-groups`} className="qosp-text-link">
          {copy("modifierManageGroups")}
          <ArrowUpRight size={14} aria-hidden="true" className="qosp-flip-rtl" />
        </Link>
      </div>

      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {message ? <PortalNotice tone="success">{message}</PortalNotice> : null}

      {(view?.modifierGroups ?? []).length > 0 ? (
        <ul className="qosp-attached-list">
          {(view?.modifierGroups ?? []).map((group) => (
            <li key={group.modifierGroupPublicId} className="qosp-subcard qosp-attached-row">
              <div className="qosp-attached-body">
                <h3 className="qosp-subcard-title">
                  {group.translations[locale]?.displayName ||
                    group.translations.en.displayName ||
                    group.modifierGroupPublicId}
                </h3>
                <p className="qosp-meta-line">
                  <span dir="ltr">{group.modifierGroupPublicId}</span>
                  {" · "}
                  {staffCount(locale, "modifierOptions", group.options.length)}
                </p>
              </div>
              <button
                type="button"
                disabled={busy || mutationsDisabled}
                onClick={() => void detachGroup(group.modifierGroupPublicId)}
                className="qos-btn" data-variant="danger" data-size="sm"
              >
                {copy("modifierDetach")}
              </button>
              {view ? (
                <ProductModifierAssignmentPolicyEditor
                  locale={locale}
                  groupPublicId={group.modifierGroupPublicId}
                  assignment={group}
                  productVersion={view.productVersion}
                  disabled={busy || mutationsDisabled}
                  onSave={savePolicy}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!mutationsDisabled ? (
        <div className="qosp-attach-row">
          <PortalField label={copy("modifierAttachGroupLabel")}>
            <select
              className="qos-select"
              value={selectedGroupPublicId}
              disabled={busy || unattachedGroups.length === 0}
              onChange={(event) => setSelectedGroupPublicId(event.target.value)}
            >
              <option value="">{copy("modifierSelectGroup")}</option>
              {unattachedGroups.map((group) => (
                <option key={group.publicId} value={group.publicId}>
                  {group.translations.en.displayName || group.internalName}
                </option>
              ))}
            </select>
          </PortalField>
          <button
            type="button"
            disabled={busy || !selectedGroupPublicId || !view}
            onClick={() => void attachGroup()}
            className="qos-btn" data-variant="primary"
          >
            {copy("modifierAttach")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
