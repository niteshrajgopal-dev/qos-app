"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ModifierGroupEditorProps = {
  tenantId: string;
  groupPublicId: string;
};

type OptionRow = {
  publicId: string;
  sortOrder: number;
  isDefault: boolean;
  allowsQuantity: boolean;
  maxQuantity: number;
  status: "active" | "archived";
  priceMinor: number;
  translations: {
    en: { displayName: string };
    ar: { displayName: string };
  };
};

type GroupState = {
  publicId: string;
  internalName: string;
  minSelections: number;
  maxSelections: number;
  version: number;
  affectedProductCount: number;
  translations: {
    en: { displayName: string };
    ar: { displayName: string };
  };
  options: OptionRow[];
};

function minorToMajor(value: number) {
  return (value / 100).toFixed(2);
}

function majorToMinor(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

export function ModifierGroupEditor({
  tenantId,
  groupPublicId,
}: ModifierGroupEditorProps) {
  const [group, setGroup] = useState<GroupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newOption, setNewOption] = useState({
    enLabel: "",
    arLabel: "",
    priceMajor: "0.00",
    isDefault: false,
  });

  const loadGroup = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/modifier-groups/${groupPublicId}`,
      );
      const payload = (await response.json()) as {
        group?: GroupState;
        error?: string;
      };

      if (!response.ok || !payload.group) {
        throw new Error(payload.error ?? "Unable to load modifier group.");
      }

      setGroup(payload.group);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load modifier group.",
      );
    } finally {
      setBusy(false);
    }
  }, [groupPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGroup();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadGroup]);

  async function saveGroupRules() {
    if (!group) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/modifier-groups/${groupPublicId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: group.version,
            internalName: group.internalName,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections,
            translations: group.translations,
          }),
        },
      );
      const payload = (await response.json()) as {
        group?: GroupState;
        error?: string;
      };

      if (!response.ok || !payload.group) {
        throw new Error(payload.error ?? "Unable to save modifier group.");
      }

      setGroup(payload.group);
      setMessage("Modifier group saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save modifier group.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveOption(option: OptionRow) {
    if (!group) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/modifier-groups/${groupPublicId}/options/${option.publicId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedGroupVersion: group.version,
            translations: option.translations,
            priceMinor: option.priceMinor,
            isDefault: option.isDefault,
            allowsQuantity: option.allowsQuantity,
            maxQuantity: option.maxQuantity,
          }),
        },
      );
      const payload = (await response.json()) as {
        group?: GroupState;
        error?: string;
      };

      if (!response.ok || !payload.group) {
        throw new Error(payload.error ?? "Unable to save modifier option.");
      }

      setGroup(payload.group);
      setMessage("Modifier option saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save modifier option.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createOption(event: React.FormEvent) {
    event.preventDefault();
    if (!group) {
      return;
    }

    const priceMinor = majorToMinor(newOption.priceMajor);
    if (priceMinor == null) {
      setError("Enter a valid AED price for the new option.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/modifier-groups/${groupPublicId}/options`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedGroupVersion: group.version,
            translations: {
              en: { displayName: newOption.enLabel.trim() },
              ar: { displayName: newOption.arLabel.trim() },
            },
            priceMinor,
            isDefault: newOption.isDefault,
          }),
        },
      );
      const payload = (await response.json()) as {
        group?: GroupState;
        error?: string;
      };

      if (!response.ok || !payload.group) {
        throw new Error(payload.error ?? "Unable to create modifier option.");
      }

      setGroup(payload.group);
      setNewOption({
        enLabel: "",
        arLabel: "",
        priceMajor: "0.00",
        isDefault: false,
      });
      setMessage("Modifier option added.");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create modifier option.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <p className="text-sm text-zinc-600">
        {error ?? (busy ? "Loading modifier group..." : "Modifier group not found.")}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <section className="rounded-xl border border-zinc-200 p-4">
        <h2 className="text-lg font-semibold">Group rules</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Attached to {group.affectedProductCount} product(s). Version{" "}
          {group.version}.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Internal name</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={group.internalName}
              disabled={busy}
              onChange={(event) =>
                setGroup({ ...group, internalName: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Min selections</span>
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={group.minSelections}
              disabled={busy}
              onChange={(event) =>
                setGroup({
                  ...group,
                  minSelections: Number.parseInt(event.target.value, 10) || 0,
                })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Max selections</span>
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={group.maxSelections}
              disabled={busy}
              onChange={(event) =>
                setGroup({
                  ...group,
                  maxSelections: Number.parseInt(event.target.value, 10) || 0,
                })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">English label</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={group.translations.en.displayName}
              disabled={busy}
              onChange={(event) =>
                setGroup({
                  ...group,
                  translations: {
                    ...group.translations,
                    en: { displayName: event.target.value },
                  },
                })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Arabic label</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={group.translations.ar.displayName}
              disabled={busy}
              onChange={(event) =>
                setGroup({
                  ...group,
                  translations: {
                    ...group.translations,
                    ar: { displayName: event.target.value },
                  },
                })
              }
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveGroupRules()}
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Save group
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Options</h2>
        {group.options.map((option) => (
          <article
            key={option.publicId}
            className="rounded-xl border border-zinc-200 p-4"
          >
            <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs">
              {option.publicId}
            </code>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">English label</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={option.translations.en.displayName}
                  disabled={busy || option.status === "archived"}
                  onChange={(event) =>
                    setGroup({
                      ...group,
                      options: group.options.map((entry) =>
                        entry.publicId === option.publicId
                          ? {
                              ...entry,
                              translations: {
                                ...entry.translations,
                                en: { displayName: event.target.value },
                              },
                            }
                          : entry,
                      ),
                    })
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Arabic label</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={option.translations.ar.displayName}
                  disabled={busy || option.status === "archived"}
                  onChange={(event) =>
                    setGroup({
                      ...group,
                      options: group.options.map((entry) =>
                        entry.publicId === option.publicId
                          ? {
                              ...entry,
                              translations: {
                                ...entry.translations,
                                ar: { displayName: event.target.value },
                              },
                            }
                          : entry,
                      ),
                    })
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">AED price delta</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={minorToMajor(option.priceMinor)}
                  disabled={busy || option.status === "archived"}
                  onChange={(event) => {
                    const priceMinor = majorToMinor(event.target.value);
                    if (priceMinor == null) {
                      return;
                    }

                    setGroup({
                      ...group,
                      options: group.options.map((entry) =>
                        entry.publicId === option.publicId
                          ? { ...entry, priceMinor }
                          : entry,
                      ),
                    });
                  }}
                />
              </label>
            </div>
            {option.status === "active" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveOption(option)}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  Save option
                </button>
                {!option.isDefault ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void saveOption({ ...option, isDefault: true })
                    }
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Make default
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void saveOption({ ...option, status: "archived" })
                  }
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Archive
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <form
        onSubmit={(event) => void createOption(event)}
        className="rounded-xl border border-dashed border-zinc-300 p-4"
      >
        <h3 className="text-lg font-medium">Add option</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">English label</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={newOption.enLabel}
              disabled={busy}
              onChange={(event) =>
                setNewOption({ ...newOption, enLabel: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Arabic label</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={newOption.arLabel}
              disabled={busy}
              onChange={(event) =>
                setNewOption({ ...newOption, arLabel: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">AED price delta</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={newOption.priceMajor}
              disabled={busy}
              onChange={(event) =>
                setNewOption({ ...newOption, priceMajor: event.target.value })
              }
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Add option
        </button>
      </form>

      <Link
        href={`/tenants/${tenantId}/catalogue/modifier-groups`}
        className="inline-block text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
      >
        Back to modifier groups
      </Link>
    </div>
  );
}
