import * as React from "react";

export interface TagProps {
  children?: React.ReactNode;
  /** When supplied, renders the remove affordance. */
  onRemove?: () => void;
}

export declare function Tag(props: TagProps): JSX.Element;
