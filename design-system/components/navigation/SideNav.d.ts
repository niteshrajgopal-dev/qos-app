import * as React from "react";

export interface SideNavProps {
  groups?: Array<{ label?: string; items: Array<{ id: string; label: string; icon?: string; count?: number; children?: Array<{ id: string; label: string; count?: number }> }> }>;
  activeId?: string;
  onNavigate?: (id: string) => void;
  brand?: React.ReactNode;
  footer?: React.ReactNode;
  collapsed?: boolean;
}

export declare function SideNav(props: SideNavProps): JSX.Element;
