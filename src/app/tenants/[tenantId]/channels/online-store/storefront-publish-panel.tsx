"use client";

import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type StorefrontSummary = {
  publicId: string;
  internalName: string;
  slug: string;
  status: "draft" | "active" | "archived";
  draftVersion: number;
  primaryHostname: string | null;
  activeRelease: {
    releasePublicId: string;
    releaseVersion: number;
    publishedAt: string;
    publishedBySubject: string;
  } | null;
};

type ReleaseRow = {
  publicId: string;
  releaseVersion: number;
  publishedBySubject: string;
  createdAt: string | Date;
  isActive: boolean;
};

type StorefrontPublishPanelProps = {
  tenantId: string;
  storefront: StorefrontSummary;
  isAdministrator: boolean;
  onStorefrontUpdated: () => Promise<void>;
};

function formatTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString();
}

export function StorefrontPublishPanel({
  tenantId,
  storefront,
  isAdministrator,
  onStorefrontUpdated,
}: StorefrontPublishPanelProps) {
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<
    Array<{ field: string; message: string }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadReleases = useCallback(async () => {
    setBusy(true);
    setError(null);
    setValidationIssues([]);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefront.publicId}/releases`,
      );
      const payload = (await response.json()) as {
        releases?: ReleaseRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load release history.");
      }

      setReleases(
        [...(payload.releases ?? [])].sort(
          (left, right) => right.releaseVersion - left.releaseVersion,
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load release history.",
      );
    } finally {
      setBusy(false);
    }
  }, [storefront.publicId, tenantId]);

  const publishDraft = useCallback(async () => {
    if (!isAdministrator) {
      setError("Administrator membership is required to publish.");
      return;
    }

    setBusy(true);
    setError(null);
    setValidationIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefront.publicId}/publish`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const payload = (await response.json()) as {
        publish?: {
          releasePublicId: string;
          releaseVersion: number;
          idempotentReplay: boolean;
        };
        error?: string;
        issues?: Array<{ field: string; message: string }>;
      };

      if (!response.ok) {
        setValidationIssues(payload.issues ?? []);
        throw new Error(payload.error ?? "Unable to publish storefront.");
      }

      const publish = payload.publish;
      if (!publish) {
        throw new Error("Publish response was incomplete.");
      }

      setMessage(
        publish.idempotentReplay
          ? `Release v${publish.releaseVersion} is already live (idempotent replay).`
          : `Release v${publish.releaseVersion} is now live.`,
      );

      await loadReleases();
      await onStorefrontUpdated();
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish storefront.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    isAdministrator,
    loadReleases,
    onStorefrontUpdated,
    storefront.publicId,
    tenantId,
  ]);

  const rollbackRelease = useCallback(async () => {
    if (!rollbackTarget) {
      return;
    }

    if (!isAdministrator) {
      setError("Administrator membership is required to roll back.");
      return;
    }

    setBusy(true);
    setError(null);
    setValidationIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefront.publicId}/rollback`,
        {
          method: "POST",
          body: JSON.stringify({
            releasePublicId: rollbackTarget.publicId,
          }),
        },
      );
      const payload = (await response.json()) as {
        rollback?: {
          releasePublicId: string;
          releaseVersion: number;
          idempotentReplay: boolean;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to roll back storefront.");
      }

      const rollback = payload.rollback;
      if (!rollback) {
        throw new Error("Rollback response was incomplete.");
      }

      setMessage(
        rollback.idempotentReplay
          ? `Release v${rollback.releaseVersion} was already active.`
          : `Rolled back to release v${rollback.releaseVersion}.`,
      );
      setRollbackTarget(null);

      await loadReleases();
      await onStorefrontUpdated();
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error
          ? rollbackError.message
          : "Unable to roll back storefront.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    isAdministrator,
    loadReleases,
    onStorefrontUpdated,
    rollbackTarget,
    storefront.publicId,
    tenantId,
  ]);

  return (
    <section className="space-y-6 rounded-xl border border-zinc-200 bg-zinc-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{storefront.internalName}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {storefront.publicId} · {storefront.status} · draft v
            {storefront.draftVersion}
          </p>
          {storefront.primaryHostname ? (
            <p className="mt-1 text-sm text-zinc-600">
              Primary domain{" "}
              <a
                href={`https://${storefront.primaryHostname}`}
                className="font-medium text-zinc-900 underline-offset-4 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {storefront.primaryHostname}
              </a>
            </p>
          ) : null}
        </div>
        {storefront.activeRelease ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <p className="font-medium">
              Live release v{storefront.activeRelease.releaseVersion}
            </p>
            <p className="mt-1 text-emerald-800">
              {formatTimestamp(storefront.activeRelease.publishedAt)} ·{" "}
              {storefront.activeRelease.publishedBySubject}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            No active release yet. Draft edits are not visible to customers.
          </div>
        )}
      </div>

      <p className="text-sm text-zinc-600">
        Publishing creates an immutable release and switches the live manifest
        without redeploying the shared storefront renderer. Rollback reactivates
        a prior release; nothing is deleted.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadReleases()}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          Load publishing history
        </button>
        <button
          type="button"
          disabled={busy || !isAdministrator}
          onClick={() => void publishDraft()}
          className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Publish draft
        </button>
      </div>

      {!isAdministrator ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          Signed-in staff can view history. Administrator membership is required
          to publish or roll back.
        </p>
      ) : null}

      {releases.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Release</th>
                <th className="px-4 py-3 font-medium">Published</th>
                <th className="px-4 py-3 font-medium">By</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <tr key={release.publicId} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">
                    v{release.releaseVersion}
                    <span className="mt-1 block font-normal text-zinc-500">
                      {release.publicId}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {formatTimestamp(release.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {release.publishedBySubject}
                  </td>
                  <td className="px-4 py-3">
                    {release.isActive ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                        Live
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!release.isActive && isAdministrator ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRollbackTarget(release)}
                        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                      >
                        Roll back
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rollbackTarget ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">
            Roll back to release v{rollbackTarget.releaseVersion}?
          </p>
          <p className="mt-2">
            Customers on{" "}
            {storefront.primaryHostname ?? "this storefront"} will see the prior
            immutable release. The current live release stays in history.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void rollbackRelease()}
              className="rounded-full bg-amber-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Confirm rollback
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRollbackTarget(null)}
              className="rounded-full border border-amber-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {validationIssues.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Publish blocked</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {validationIssues.map((issue) => (
              <li key={`${issue.field}:${issue.message}`}>
                {issue.field}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
    </section>
  );
}
