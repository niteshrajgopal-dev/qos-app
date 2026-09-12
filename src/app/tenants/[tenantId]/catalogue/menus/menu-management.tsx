"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

type MenuSummary = {
  publicId: string;
  internalName: string;
  displayName: string;
  status: "draft" | "active" | "archived";
  version: number;
  isLive: boolean;
  hasUnpublishedChanges: boolean;
  sectionCount: number;
  itemCount: number;
  updatedAt: string;
};

type MenuManagementProps = {
  tenantId: string;
};

export function MenuManagement({ tenantId }: MenuManagementProps) {
  const [staffSubject, setStaffSubject] = useState("admin@quotes.test");
  const [staffEmail, setStaffEmail] = useState("admin@quotes.test");
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const headers = {
    "X-QOS-Staff-Subject": staffSubject,
    "X-QOS-Staff-Email": staffEmail,
  };

  const loadMenus = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/tenants/${tenantId}/catalogue/menus`, {
      headers,
    });
    const payload = (await response.json()) as {
      menus?: MenuSummary[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load menus.");
    }

    setMenus(payload.menus ?? []);
  }, [staffEmail, staffSubject, tenantId]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">
            Staff subject
          </span>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={staffSubject}
            onChange={(event) => setStaffSubject(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Staff email</span>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={staffEmail}
            onChange={(event) => setStaffEmail(event.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            void loadMenus().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load menus.",
              );
            })
          }
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          Load menus
        </button>
        <Link
          href={`/tenants/${tenantId}/catalogue/menus/new`}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Create a menu
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4">
        {menus.length === 0 ? (
          <p className="text-sm text-zinc-600">No draft menus yet.</p>
        ) : (
          menus.map((menu) => (
            <article
              key={menu.publicId}
              className="rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900">{menu.displayName}</p>
                  <p className="text-sm text-zinc-600">
                    {menu.internalName} · {menu.sectionCount} sections ·{" "}
                    {menu.itemCount} items
                  </p>
                  <p className="text-sm text-zinc-600">
                    Status: {menu.status}
                    {menu.isLive ? " · Live" : ""}
                    {menu.hasUnpublishedChanges ? " · Unpublished changes" : ""}
                  </p>
                </div>
                <Link
                  href={`/tenants/${tenantId}/catalogue/menus/${menu.publicId}/edit`}
                  className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
                >
                  Edit menu
                </Link>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
