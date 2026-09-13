"use client";

import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type AuditEvent = {
  id: string;
  actorSubject: string;
  actorClass: string;
  action: string;
  entityType: string;
  entityPublicId: string;
  entityVersion: number | null;
  changeSummary: Record<string, unknown>;
  occurredAt: string;
};

type AuditPage = {
  events: AuditEvent[];
  nextCursor: {
    occurredAt: string;
    id: string;
  } | null;
};

type TenantAuditViewerProps = {
  tenantId: string;
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function summarizeChangeSummary(summary: Record<string, unknown>) {
  try {
    return JSON.stringify(summary, null, 2);
  } catch {
    return String(summary);
  }
}

export function TenantAuditViewer({ tenantId }: TenantAuditViewerProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<AuditPage["nextCursor"]>(null);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityPublicId, setEntityPublicId] = useState("");
  const [actorSubject, setActorSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const buildQuery = useCallback(
    (cursor?: AuditPage["nextCursor"]) => {
      const params = new URLSearchParams();
      if (action.trim()) {
        params.set("action", action.trim());
      }
      if (entityType.trim()) {
        params.set("entityType", entityType.trim());
      }
      if (entityPublicId.trim()) {
        params.set("entityPublicId", entityPublicId.trim());
      }
      if (actorSubject.trim()) {
        params.set("actorSubject", actorSubject.trim());
      }
      params.set("limit", "25");
      if (cursor) {
        params.set("cursorOccurredAt", cursor.occurredAt);
        params.set("cursorId", cursor.id);
      }
      return params.toString();
    },
    [action, actorSubject, entityPublicId, entityType],
  );

  const loadPage = useCallback(
    async (cursor?: AuditPage["nextCursor"], append = false) => {
      setBusy(true);
      setError(null);

      try {
        const response = await staffApiFetch(
          `/api/tenants/${tenantId}/audit-events?${buildQuery(cursor)}`,
        );
        const payload = (await response.json()) as AuditPage & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load audit events.");
        }

        setEvents((current) =>
          append ? [...current, ...(payload.events ?? [])] : payload.events ?? [],
        );
        setNextCursor(payload.nextCursor ?? null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load audit events.",
        );
      } finally {
        setBusy(false);
      }
    },
    [buildQuery, tenantId],
  );

  return (
    <div className="space-y-6">
      <form
        className="grid gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void loadPage();
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Action</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="storefront.publish"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Entity type</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            placeholder="storefront_release"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Entity ID</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={entityPublicId}
            onChange={(event) => setEntityPublicId(event.target.value)}
            placeholder="rel_..."
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Actor subject</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={actorSubject}
            onChange={(event) => setActorSubject(event.target.value)}
            placeholder="admin@example.com"
          />
        </label>
        <div className="md:col-span-2 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Loading..." : "Search"}
          </button>
          {nextCursor ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadPage(nextCursor, true)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-60"
            >
              Load more
            </button>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {events.length === 0 && !busy ? (
        <p className="text-sm text-zinc-500">
          No audit events loaded yet. Run a search to view protected changes.
        </p>
      ) : null}

      <div className="space-y-4">
        {events.map((event) => (
          <article
            key={event.id}
            className="rounded-xl border border-zinc-200 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-zinc-900">{event.action}</p>
                <p className="mt-1 text-sm text-zinc-600">
                  {event.entityType} · {event.entityPublicId}
                  {event.entityVersion != null
                    ? ` · v${event.entityVersion}`
                    : ""}
                </p>
              </div>
              <p className="text-sm text-zinc-500">
                {formatTimestamp(event.occurredAt)}
              </p>
            </div>
            <p className="mt-3 text-sm text-zinc-700">
              Actor:{" "}
              <span className="font-medium">{event.actorSubject}</span> (
              {event.actorClass.replaceAll("_", " ")})
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
              {summarizeChangeSummary(event.changeSummary)}
            </pre>
          </article>
        ))}
      </div>
    </div>
  );
}
