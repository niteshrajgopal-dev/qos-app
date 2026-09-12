import * as React from "react";

export interface CommandPaletteProps {
  open?: boolean;
  query?: string;
  onQueryChange?: (q: string) => void;
  groups?: Array<{ label: string; items: Array<{ id: string; label: string; meta?: string; kind?: string; icon?: string; intelligence?: boolean }> }>;
  onSelect?: (item: any) => void;
  onClose?: () => void;
  placeholder?: string;
}

export declare function CommandPalette(props: CommandPaletteProps): JSX.Element;
