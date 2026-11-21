import { staffApiFetch } from "@/lib/staff/dev-fetch";
import {
  BRANCH_SEARCH_PARAM,
  branchPreferenceStorageKey,
  type BranchContextPayload,
  type BranchSelection,
  withBranchParam,
} from "@/lib/staff/branch-selection";

/* Browser-side helpers for the staff branch context. The stored value and the
   URL parameter are preferences only: the shell always resolves them against
   the list returned by the server. */

export async function fetchBranchContext(
  tenantId: string,
): Promise<{ ok: true; data: BranchContextPayload } | { ok: false; status: number }> {
  try {
    const response = await staffApiFetch(
      `/api/tenants/${encodeURIComponent(tenantId)}/staff/branch-context`,
    );
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return { ok: true, data: (await response.json()) as BranchContextPayload };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function readBranchSearchParam(): string | null {
  return new URLSearchParams(window.location.search).get(BRANCH_SEARCH_PARAM);
}

export function readStoredBranchPreference(tenantId: string): string | null {
  try {
    return window.localStorage.getItem(branchPreferenceStorageKey(tenantId));
  } catch {
    return null;
  }
}

export function writeStoredBranchPreference(tenantId: string, selection: BranchSelection) {
  try {
    window.localStorage.setItem(branchPreferenceStorageKey(tenantId), selection);
  } catch {
    // Storage can be unavailable (private mode, quota); the preference is optional.
  }
}

/** Puts the selection in the address bar without a navigation, so pages keep their state. */
export function replaceBranchSearchParam(selection: BranchSelection) {
  const { pathname, search, hash } = window.location;
  const next = withBranchParam(`${pathname}${search}${hash}`, selection);
  if (next !== `${pathname}${search}${hash}`) {
    window.history.replaceState(null, "", next);
  }
}
