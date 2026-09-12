import * as React from "react";

export interface DrawerProps {
  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number | string;
  onClose?: () => void;
}

export declare function Drawer(props: DrawerProps): JSX.Element;
