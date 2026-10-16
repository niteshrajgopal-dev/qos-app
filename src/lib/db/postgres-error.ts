/** PostgreSQL SQLSTATE values that mean the worker should not retry the job step. */
const TERMINAL_SQLSTATE = new Set(["42501", "42703", "42P01"]);

export type PostgresErrorDetails = {
  sqlState: string | null;
  message: string;
  table: string | null;
  column: string | null;
  schema: string | null;
  /** True when the error is a schema/permission problem that reclaim will not fix. */
  terminal: boolean;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extracts safe, structured fields from postgres.js / Drizzle database errors.
 * Never includes query parameters or connection secrets.
 */
export function describePostgresError(error: unknown): PostgresErrorDetails | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const record = error as Record<string, unknown>;
  const sqlState = readString(record.code);
  if (!sqlState) {
    return null;
  }
  const message = readString(record.message) ?? "Database error.";
  const table = readString(record.table_name) ?? readString(record.table);
  const column = readString(record.column_name) ?? readString(record.column);
  const schema = readString(record.schema_name) ?? readString(record.schema);
  return {
    sqlState,
    message,
    table,
    column,
    schema,
    terminal: TERMINAL_SQLSTATE.has(sqlState),
  };
}

export function postgresErrorLogFields(error: unknown): Record<string, string> {
  const details = describePostgresError(error);
  if (!details) {
    return {};
  }
  const fields: Record<string, string> = {
    dbMessage: details.message,
  };
  if (details.sqlState) {
    fields.dbSqlState = details.sqlState;
  }
  if (details.schema) {
    fields.dbSchema = details.schema;
  }
  if (details.table) {
    fields.dbTable = details.table;
  }
  if (details.column) {
    fields.dbColumn = details.column;
  }
  return fields;
}
