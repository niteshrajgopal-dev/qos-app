import * as React from "react";

export interface TenantSwitcherProps {
  tenants?: Array<{ id: string; name: string; meta?: string }>;
  value?: string;
  onChange?: (id: string) => void;
  label?: string;
}

export declare function TenantSwitcher(props: TenantSwitcherProps): JSX.Element;
