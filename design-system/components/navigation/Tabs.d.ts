import * as React from "react";

export interface TabsProps {
  tabs?: Array<string | { id: string; label: string; icon?: string; count?: number; tone?: string; disabled?: boolean }>;
  value?: string;
  onChange?: (id: string) => void;
}

export declare function Tabs(props: TabsProps): JSX.Element;
