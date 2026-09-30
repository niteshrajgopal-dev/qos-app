"use client";

import { createContext, useContext } from "react";

export type PortalShellState = {
  tenantId: string;
  tenantName: string;
  personName: string;
  roleLabel: string;
  motion: boolean;
  toggleMotion: () => void;
};

const PortalShellContext = createContext<PortalShellState | null>(null);

export const PortalShellProvider = PortalShellContext.Provider;

/** Shell-owned state (identity, business, ambient motion) for screens inside it. */
export function usePortalShell(): PortalShellState {
  const state = useContext(PortalShellContext);

  if (!state) {
    throw new Error("usePortalShell must be used inside the staff portal shell.");
  }

  return state;
}
