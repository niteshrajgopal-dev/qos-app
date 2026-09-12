"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

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
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadMenus = useCallback(async () => {
    setError(null);
    const response = await staffApiFetch(
      `/api/tenants/${tenantId}/catalogue/menus`,
    );
    const payload = (await response.json()) as {
      menus?: MenuSummary[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load menus.");
    }

    setMenus(payload.menus ?? []);
  }, [tenantId]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600">
        Sign in at{" "}
        <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
          staff sign-in
        </Link>{" "}
        to load and edit menus with your session cookie.
      </p>

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
          New menu
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        {menus.map((menu) => (
          <article
            key={menu.publicId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-4"
          >
            <div>
              <p className="font-medium text-zinc-900">{menu.displayName}</p>
              <p className="text-sm text-zinc-600">
                {menu.internalName} · {menu.status} · v{menu.version}
              </p>
            </div>
            <Link
              href={`/tenants/${tenantId}/catalogue/menus/${menu.publicId}/edit`}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
            >
              Edit
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
