import * as React from "react";

export interface EmptyStateProps {
  icon?: string;
  title?: string;
  body?: string;
  tone?: "default" | "brand";
  actions?: React.ReactNode;
}

export declare function EmptyState(props: EmptyStateProps): JSX.Element;
