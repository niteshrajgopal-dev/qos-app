import { timingSafeEqual } from "node:crypto";

export type OperatorIdentity = {
  subject: string;
};

export class OperatorAuthorizationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "OperatorAuthorizationError";
    this.statusCode = statusCode;
  }
}

function readHeader(headers: Headers, name: string) {
  return headers.get(name)?.trim() ?? "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireOperatorIdentity(
  headers: Headers,
  configuredKey = process.env.PLATFORM_OPERATOR_API_KEY,
): OperatorIdentity {
  const providedKey = readHeader(headers, "x-qos-operator-key");
  const operatorSubject = readHeader(headers, "x-qos-operator-subject");

  if (!configuredKey) {
    throw new OperatorAuthorizationError(
      "Platform operator provisioning is not configured.",
      503,
    );
  }

  if (!providedKey || !safeEqual(providedKey, configuredKey)) {
    throw new OperatorAuthorizationError("Operator authorization required.");
  }

  if (!operatorSubject) {
    throw new OperatorAuthorizationError(
      "Operator subject is required for audited provisioning.",
      400,
    );
  }

  return { subject: operatorSubject };
}

export function rejectTenantSelfServiceProvisioning(headers: Headers) {
  const tenantRole = readHeader(headers, "x-qos-tenant-staff-role");
  if (tenantRole) {
    throw new OperatorAuthorizationError(
      "Tenant staff cannot provision businesses.",
      403,
    );
  }
}
