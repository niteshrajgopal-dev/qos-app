/* Client-safe branch context types and selection rules (QOS-192).
   No database or server imports live here: the staff shell resolves its
   selection with the same function the API uses, against the list the server
   returned. A URL parameter or stored preference is only ever a request; it
   never grants access. Server-side guards are in branch-context.ts. */

/** Sentinel for the authorised All Branches read view. It is not a location. */
export const ALL_BRANCHES = "all" as const;

export type AllBranches = typeof ALL_BRANCHES;

/** A location public id, or All Branches. */
export type BranchSelection = string;

export const BRANCH_SEARCH_PARAM = "branch";

export type PermittedBranch = {
  publicId: string;
  name: string;
  status: "active" | "suspended";
  timezone: string;
  /** Locations carry no currency of their own; this is the tenant base currency. */
  currency: string;
};

export type BusinessBranchLabelKey = "dubai" | "al-ain" | "azur-cafe";

export type RequestedBusinessBranchLabel = {
  key: BusinessBranchLabelKey;
  label: string;
  mappingStatus: "unmapped";
  locationPublicId: null;
};

/**
 * Business branch names reported by the client for Phase 2 (QOS-161, D1).
 * They are UNVERIFIED: nobody has confirmed which existing QOS location, if
 * any, each one corresponds to. They are therefore always `unmapped` and are
 * never used to rename, create or reassign a location. Persisting a confirmed
 * mapping (migration, administrator write path and audit) is a follow-up once
 * the owner supplies the mapping.
 */
export const REQUESTED_BUSINESS_BRANCH_LABELS: readonly RequestedBusinessBranchLabel[] = [
  { key: "dubai", label: "Dubai", mappingStatus: "unmapped", locationPublicId: null },
  { key: "al-ain", label: "Al Ain", mappingStatus: "unmapped", locationPublicId: null },
  { key: "azur-cafe", label: "Azur Cafe", mappingStatus: "unmapped", locationPublicId: null },
];

export type BranchContextPayload = {
  baseCurrency: string;
  role: "administrator" | "user";
  branches: PermittedBranch[];
  allBranchesAllowed: boolean;
  defaultSelection: BranchSelection | null;
  /** Present only when the request carried a `branch` parameter that passed validation. */
  selected?: BranchSelection;
  requestedBusinessLabels: RequestedBusinessBranchLabel[];
};

/**
 * All Branches is a read view for administrators, and for users who hold more
 * than one location scope. A single-scope user never gets it.
 */
export function isAllBranchesAllowed(
  role: "administrator" | "user",
  permittedCount: number,
): boolean {
  if (permittedCount === 0) {
    return false;
  }

  return role === "administrator" || permittedCount > 1;
}

/** Administrators start on All Branches; everyone else on their first permitted branch. */
export function defaultBranchSelection(
  role: "administrator" | "user",
  branches: readonly PermittedBranch[],
  allBranchesAllowed: boolean,
): BranchSelection | null {
  if (role === "administrator" && allBranchesAllowed) {
    return ALL_BRANCHES;
  }

  return branches[0]?.publicId ?? null;
}

/** True when the selection is All Branches or one of the permitted locations. */
export function isPermittedBranchSelection(
  selection: string,
  branches: readonly PermittedBranch[],
  allBranchesAllowed: boolean,
): boolean {
  if (selection === ALL_BRANCHES) {
    return allBranchesAllowed;
  }

  return branches.some((branch) => branch.publicId === selection);
}

export type BranchResolution = {
  selection: BranchSelection | null;
  /** The requested value was present but not permitted, so the default was used. */
  rejected: string | null;
};

/**
 * Picks the branch to show. Candidates are tried in order (URL first, then the
 * stored preference); the first permitted one wins. A rejected candidate is
 * reported so the shell can say why the context changed.
 */
export function resolveBranchSelection(
  candidates: ReadonlyArray<string | null | undefined>,
  context: Pick<BranchContextPayload, "role" | "branches" | "allBranchesAllowed">,
): BranchResolution {
  let rejected: string | null = null;

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") {
      continue;
    }

    if (
      isPermittedBranchSelection(candidate, context.branches, context.allBranchesAllowed)
    ) {
      return { selection: candidate, rejected };
    }

    rejected ??= candidate;
  }

  return {
    selection: defaultBranchSelection(
      context.role,
      context.branches,
      context.allBranchesAllowed,
    ),
    rejected,
  };
}

export function branchPreferenceStorageKey(tenantId: string): string {
  return `qos-staff-branch:${tenantId}`;
}

/** Adds (or replaces) the branch parameter on an in-app href. */
export function withBranchParam(href: string, selection: BranchSelection | null): string {
  if (!selection) {
    return href;
  }

  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  params.set(BRANCH_SEARCH_PARAM, selection);

  return `${path}?${params.toString()}${hash}`;
}
