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
