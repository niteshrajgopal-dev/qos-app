"use client";

import { createContext, useContext } from "react";

import type { UnsavedWorkRegistration } from "@/lib/staff/branch-change-guard-state";
import type {
  BranchSelection,
  PermittedBranch,
  RequestedBusinessBranchLabel,
} from "@/lib/staff/branch-selection";

/** Branch context loaded from the server after the session (QOS-192). */
export type PortalBranchState = {
  status: "idle" | "loading" | "ready" | "error";
  /** Selected location public id, `all`, or null when nothing is permitted. */
  selection: BranchSelection | null;
  branches: PermittedBranch[];
  allBranchesAllowed: boolean;
  baseCurrency: string | null;
  role: "administrator" | "user" | null;
  requestedBusinessLabels: RequestedBusinessBranchLabel[];
};

export type PortalShellState = {
  tenantId: string;
  tenantName: string;
  personName: string;
  roleLabel: string;
  motion: boolean;
  toggleMotion: () => void;
  branch: PortalBranchState;
  /** Changes branch, asking first when a screen has unsaved work. */
  requestBranchChange: (selection: BranchSelection) => void;
  /** Used by `useUnsavedWork`; returns the unregister function. */
  registerUnsavedWork: (registration: UnsavedWorkRegistration) => () => void;
};

const PortalShellContext = createContext<PortalShellState | null>(null);

export const PortalShellProvider = PortalShellContext.Provider;

/** Shell-owned state (identity, business, branch, ambient motion) for screens inside it. */
export function usePortalShell(): PortalShellState {
  const state = useContext(PortalShellContext);

  if (!state) {
    throw new Error("usePortalShell must be used inside the staff portal shell.");
  }

  return state;
}
