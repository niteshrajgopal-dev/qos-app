export type NpmAuditClassification =
  | "clean"
  | "vulnerable"
  | "unreachable"
  | "unreadable";

type AuditVulnerabilities = {
  high?: number;
  critical?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function classifyNpmAuditPayload(
  payload: unknown,
): NpmAuditClassification {
  const report = asRecord(payload);
  if (!report) {
    return "unreadable";
  }

  const metadata = asRecord(report.metadata);
  const vulnerabilities = asRecord(metadata?.vulnerabilities) as
    | AuditVulnerabilities
    | null;

  if (vulnerabilities) {
    const high = Number(vulnerabilities.high ?? 0);
    const critical = Number(vulnerabilities.critical ?? 0);
    return high + critical > 0 ? "vulnerable" : "clean";
  }

  if (
    typeof report.statusCode === "number" ||
    typeof report.error === "string" ||
    typeof report.message === "string"
  ) {
    return "unreachable";
  }

  return "unreadable";
}

export function describeNpmAuditClassification(
  classification: NpmAuditClassification,
  payload: unknown,
) {
  const report = asRecord(payload);

  if (classification === "clean") {
    return "npm audit reported no high or critical vulnerabilities.";
  }

  if (classification === "vulnerable") {
    const vulnerabilities = asRecord(asRecord(report?.metadata)?.vulnerabilities);
    return `npm audit found high=${Number(vulnerabilities?.high ?? 0)} critical=${Number(vulnerabilities?.critical ?? 0)}.`;
  }

  if (classification === "unreachable") {
    const detail =
      (typeof report?.message === "string" && report.message) ||
      (typeof report?.error === "string" && report.error) ||
      "advisory API did not return a vulnerability report";
    return `npm audit endpoint is unavailable (${detail}).`;
  }

  return "npm audit returned an unreadable payload.";
}
