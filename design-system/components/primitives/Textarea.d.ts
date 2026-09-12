import * as React from "react";

export interface TextareaProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  rows?: number;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export declare function Textarea(props: TextareaProps): JSX.Element;
