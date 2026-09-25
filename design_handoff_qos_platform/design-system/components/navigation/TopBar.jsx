import React from "react";

export function TopBar({ children, ...rest }) {
  return <header className="qos-topbar" {...rest}>{children}</header>;
}
