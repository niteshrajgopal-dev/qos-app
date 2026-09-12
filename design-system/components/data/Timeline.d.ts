import * as React from "react";

export interface TimelineProps {
  items?: Array<{ id?: string; title: React.ReactNode; meta?: React.ReactNode; tone?: "neutral" | "success" | "error" | "processing" | "intelligence"; icon?: string; detail?: React.ReactNode }>;
}

export declare function Timeline(props: TimelineProps): JSX.Element;
