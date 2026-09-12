import * as React from "react";

export interface IntelligenceCardProps {
  /** Names what this is: Insight, Anomaly, Recommendation, Summary, Mapping. */
  kind?: string;
  title?: React.ReactNode;
  /** Ordered claims. kind is the epistemic label: "System fact", "AI interpretation", "AI recommendation". */
  claims?: Array<{ kind: string; text: React.ReactNode }>;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  confidence?: string;
}

export declare function IntelligenceCard(props: IntelligenceCardProps): JSX.Element;

export interface AiBadgeProps {
  children?: React.ReactNode;
}

export declare function AiBadge(props: AiBadgeProps): JSX.Element;
