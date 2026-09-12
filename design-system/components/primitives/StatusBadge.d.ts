import * as React from "react";

export interface StatusBadgeProps {
  /** Key from QOS_STATES — live, draft, published, connected, out_of_sync, error, syncing… */
  state: keyof typeof QOS_STATES | string;
  /** Override the canonical label; the tone and icon stay fixed. */
  label?: string;
}

export declare function StatusBadge(props: StatusBadgeProps): JSX.Element;

export declare const QOS_STATES: Record<string, { tone: string; icon: string; label: string }>;
