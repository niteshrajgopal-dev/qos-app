/* Recoverable workbook errors. `code` is stable and is what the staff UI
   translates; `message` is English for logs and API clients. */

export type WorkbookErrorCode =
  | "empty_file"
  | "file_too_large"
  | "wrong_type"
  | "extension_mismatch"
  | "malformed_workbook"
  | "unsafe_workbook"
  | "workbook_too_large"
  | "too_many_sheets"
  | "too_many_rows"
  | "too_many_columns"
  | "cell_too_long"
  | "too_much_text"
  | "manifest_missing"
  | "manifest_invalid"
  | "unknown_profile"
  | "unsupported_version"
  | "legacy_parse_failed"
  | "source_layout_partial"
  | "source_layout_ambiguous"
  | "convert_unsupported_profile"
  | "convert_too_large"
  | "convert_currency_unresolved";

export class WorkbookParseError extends Error {
  readonly code: WorkbookErrorCode;
  readonly params: Record<string, string | number>;

  constructor(
    code: WorkbookErrorCode,
    message: string,
    params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "WorkbookParseError";
    this.code = code;
    this.params = params;
  }
}
