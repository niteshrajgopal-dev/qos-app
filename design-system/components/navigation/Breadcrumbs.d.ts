import * as React from "react";

export interface BreadcrumbsProps {
  items?: Array<{ id?: string; label: string; href?: string }>;
  onNavigate?: (id?: string) => void;
}

export declare function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;
