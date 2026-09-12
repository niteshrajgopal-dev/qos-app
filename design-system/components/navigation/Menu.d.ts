import * as React from "react";

export interface MenuProps {
  items?: Array<{ id?: string; label?: string; icon?: string; tone?: "danger"; selected?: boolean; shortcut?: string; separator?: boolean; header?: string }>;
  onSelect?: (id?: string) => void;
  align?: "left" | "right";
  style?: React.CSSProperties;
}

export declare function Menu(props: MenuProps): JSX.Element;
