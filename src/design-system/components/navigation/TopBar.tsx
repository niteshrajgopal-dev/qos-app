"use client";

export type TopBarProps = {

  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

import React from "react";

export function TopBar({ children, ...rest }: TopBarProps) {
  return <header className="qos-topbar" {...rest}>{children}</header>;
}
