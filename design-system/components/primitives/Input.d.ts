import * as React from "react";

export interface InputProps {
  label?: string;
  hint?: string;
  /** Error message. Sets aria-invalid and the danger ring. */
  error?: string;
  required?: boolean;
  id?: string;
  /** Leading Lucide icon name. */
  leadingIcon?: string;
  /** Trailing node — unit, counter, or IconButton. */
  trailing?: React.ReactNode;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export declare function Input(props: InputProps): JSX.Element;

export interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export declare function SearchInput(props: SearchInputProps): JSX.Element;

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children?: React.ReactNode;
}

export declare function Field(props: FieldProps): JSX.Element;
