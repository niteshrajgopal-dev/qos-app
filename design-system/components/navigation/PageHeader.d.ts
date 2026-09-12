import * as React from "react";

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  tabs?: React.ReactNode;
}

export declare function PageHeader(props: PageHeaderProps): JSX.Element;
