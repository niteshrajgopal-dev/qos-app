"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type AccessRequest = {
  id: string;
  requesterSubject: string;
  requesterEmail: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  decidedBySubject: string | null;
  decidedRole: "administrator" | "user" | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

type LocationOption = {
  id: string;
  publicId: string;
  name: string;
  slug: string;
};

type AccessRequestsReviewProps = {
  tenantId: string;
};

export function AccessRequestsReview({ tenantId }: AccessRequestsReviewProps) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<
    Record<string, string[]>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);

    const [requestsResponse, locationsResponse] = await Promise.all([
      staffApiFetch(`/api/tenants/${tenantId}/staff/access-requests`),
      staffApiFetch(`/api/tenants/${tenantId}/staff/locations`),
    ]);

    const requestsPayload = (await requestsResponse.json()) as {
      requests?: AccessRequest[];
      error?: string;
    };
    const locationsPayload = (await locationsResponse.json()) as {
      locations?: LocationOption[];
      error?: string;
    };

    if (!requestsResponse.ok) {
      throw new Error(requestsPayload.error ?? "Unable to load requests.");
    }

    if (!locationsResponse.ok) {
      throw new Error(locationsPayload.error ?? "Unable to load locations.");
    }

    setRequests(requestsPayload.requests ?? []);
    setLocations(locationsPayload.locations ?? []);
  }, [tenantId]);

  function toggleLocation(requestId: string, locationId: string) {
    setSelectedLocations((current) => {
      const existing = current[requestId] ?? [];
      const next = existing.includes(locationId)
        ? existing.filter((value) => value !== locationId)
        : [...existing, locationId];

      return { ...current, [requestId]: next };
    });
  }

  async function approveRequest(
    request: AccessRequest,
    role: "administrator" | "user",
  ) {
    setBusyRequestId(request.id);
    setError(null);

    try {
      const locationIds = selectedLocations[request.id] ?? [];
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/staff/access-requests/${request.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: request.version,
            role,
            locationIds,
          }),
        },
      );

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to approve request.");
      }

      await loadData();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Unable to approve request.",
      );
    } finally {
      setBusyRequestId(null);
    }
  }

  async function rejectRequest(request: AccessRequest) {
    setBusyRequestId(request.id);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/staff/access-requests/${request.id}/reject`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: request.version,
            decisionNote: "Rejected from administrator review UI.",
          }),
        },
      );

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reject request.");
      }

      await loadData();
    } catch (rejectError) {
      setError(
        rejectError instanceof Error
          ? rejectError.message
          : "Unable to reject request.",
      );
    } finally {
      setBusyRequestId(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Sign in as an administrator at{" "}
        <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
          staff sign-in
        </Link>{" "}
        before loading or deciding requests.
      </p>

      <button
        type="button"
        onClick={() =>
          void loadData().catch((loadError) => {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Unable to load access requests.",
            );
          })
        }
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
      >
        Load requests
      </button>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="space-y-4">
        {requests.length === 0 ? (
          <p className="text-sm text-zinc-600">No access requests yet.</p>
        ) : (
          requests.map((request) => (
            <article
              key={request.id}
              className="rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900">
                    {request.requesterEmail}
                  </p>
                  <p className="text-sm text-zinc-600">
                    Subject: {request.requesterSubject}
                  </p>
                  <p className="text-sm text-zinc-600">
                    Status: {request.status} · Version: {request.version}
                  </p>
                </div>
                {request.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyRequestId === request.id}
                      onClick={() =>
                        void approveRequest(request, "administrator")
                      }
                      className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Approve as Administrator
                    </button>
                    <button
                      type="button"
                      disabled={busyRequestId === request.id}
                      onClick={() => void approveRequest(request, "user")}
                      className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
                    >
                      Approve as User
                    </button>
                    <button
                      type="button"
                      disabled={busyRequestId === request.id}
                      onClick={() => void rejectRequest(request)}
                      className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>

              {request.status === "pending" ? (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-zinc-700">
                    Location scope
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {locations.map((location) => {
                      const checked = (
                        selectedLocations[request.id] ?? []
                      ).includes(location.id);

                      return (
                        <label
                          key={location.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              toggleLocation(request.id, location.id)
                            }
                          />
                          {location.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
