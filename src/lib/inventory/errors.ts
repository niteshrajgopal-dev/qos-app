/* QOS-195 inventory service errors. Every error carries a stable `code` the
   UI maps to EN/AR copy (error-copy.ts) and, where it applies, the request
   field that caused it. */

export class InventoryError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly field?: string;

  constructor(message: string, statusCode: number, code: string, field?: string) {
    super(message);
    this.name = "InventoryError";
    this.statusCode = statusCode;
    this.code = code;
    this.field = field;
  }
}

export class InventoryConflictError extends InventoryError {
  constructor(message: string, code: string, field?: string) {
    super(message, 409, code, field);
    this.name = "InventoryConflictError";
  }
}

/** A record another record still depends on, with how many dependants. */
export type Dependency = { kind: string; count: number };

/* QOS-196: a 409 that explains which records block the change, so the UI can
   say why an archive or a reassignment was refused. */
export class InventoryDependencyError extends InventoryConflictError {
  readonly dependencies: Dependency[];

  constructor(message: string, code: string, field: string | undefined, dependencies: Dependency[]) {
    super(message, code, field);
    this.name = "InventoryDependencyError";
    this.dependencies = dependencies;
  }
}

/* QOS-198: a 409 that carries a structured explanation, such as the item path
   of a refused prepared-recipe cycle. */
export class InventoryDetailError extends InventoryConflictError {
  readonly detail: Record<string, unknown>;

  constructor(message: string, code: string, field: string | undefined, detail: Record<string, unknown>) {
    super(message, code, field);
    this.name = "InventoryDetailError";
    this.detail = detail;
  }
}
