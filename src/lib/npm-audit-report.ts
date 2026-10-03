export const AUDIT_SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export type AuditAdvisoryCause = {
  source: number | string | null;
  /** The affected package as npm reports it on the advisory. */
  dependency: string;
  title: string;
  url: string;
  severity: AuditSeverity;
  range: string;
};

export type AuditFinding = {
  name: string;
  severity: AuditSeverity;
  isDirect: boolean;
  /** Package-name strings are causes inherited from another finding. */
  via: Array<string | AuditAdvisoryCause>;
  effects: string[];
  range: string;
  nodes: string[];
};

export type NpmAuditReport = {
  findings: AuditFinding[];
  counts: Record<AuditSeverity, number> & { total: number };
};

export type NpmAuditParseResult =
  | { kind: "report"; report: NpmAuditReport }
  | { kind: "unavailable"; reason: string };

const MAX_DETAIL = 300;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isSeverity(value: unknown): value is AuditSeverity {
  return typeof value === "string" && (AUDIT_SEVERITIES as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function truncate(text: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL ? `${oneLine.slice(0, MAX_DETAIL)}…` : oneLine;
}

function errorDetail(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }
  const errorRecord = asRecord(error);
  if (errorRecord) {
    const parts = [errorRecord.code, errorRecord.summary, errorRecord.detail].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? parts.join(": ") : "error object without details";
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload.statusCode === "number") {
    return `HTTP ${payload.statusCode}`;
  }
  return null;
}

function parseCause(value: unknown): string | AuditAdvisoryCause | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  const cause = asRecord(value);
  if (!cause) {
    return null;
  }
  const dependency = cause.dependency ?? cause.name;
  if (
    typeof dependency !== "string" ||
    typeof cause.url !== "string" ||
    typeof cause.title !== "string" ||
    typeof cause.range !== "string" ||
    !isSeverity(cause.severity)
  ) {
    return null;
  }
  const source = cause.source;
  return {
    source: typeof source === "number" || typeof source === "string" ? source : null,
    dependency,
    title: cause.title,
    url: cause.url,
    severity: cause.severity,
    range: cause.range,
  };
}

function parseFinding(key: string, value: unknown): AuditFinding | null {
  const entry = asRecord(value);
  if (
    !entry ||
    entry.name !== key ||
    !isSeverity(entry.severity) ||
    !Array.isArray(entry.via) ||
    entry.via.length === 0 ||
    !isStringArray(entry.nodes) ||
    !isStringArray(entry.effects ?? []) ||
    typeof entry.range !== "string"
  ) {
    return null;
  }
  const via: AuditFinding["via"] = [];
  for (const raw of entry.via) {
    const cause = parseCause(raw);
    if (!cause) {
      return null;
    }
    via.push(cause);
  }
  return {
    name: key,
    severity: entry.severity,
    isDirect: entry.isDirect === true,
    via,
    effects: (entry.effects as string[] | undefined) ?? [],
    range: entry.range,
    nodes: entry.nodes,
  };
}

/**
 * Validates an `npm audit --json` (report version 2) payload. Anything that is
 * not a complete, internally consistent report — npm error objects, retired
 * endpoint responses, truncated or partial output — is "unavailable": it
 * proves neither a clean audit nor a vulnerability.
 */
export function parseNpmAuditPayload(payload: unknown): NpmAuditParseResult {
  const report = asRecord(payload);
  if (!report) {
    return { kind: "unavailable", reason: "npm audit did not return a JSON object." };
  }

  if (report.auditReportVersion === undefined) {
    const detail = errorDetail(report);
    return {
      kind: "unavailable",
      reason: detail
        ? `npm audit returned an error instead of a report (${truncate(detail)}).`
        : "npm audit returned an unsupported report structure.",
    };
  }
  if (report.auditReportVersion !== 2) {
    return {
      kind: "unavailable",
      reason: `npm audit report version ${String(report.auditReportVersion)} is not supported.`,
    };
  }

  const vulnerabilities = asRecord(report.vulnerabilities);
  const metadataCounts = asRecord(asRecord(report.metadata)?.vulnerabilities);
  if (!vulnerabilities || !metadataCounts) {
    return { kind: "unavailable", reason: "npm audit report is missing vulnerabilities or metadata." };
  }

  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const key of [...AUDIT_SEVERITIES, "total"] as const) {
    const value = metadataCounts[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return { kind: "unavailable", reason: `npm audit metadata count "${key}" is invalid.` };
    }
    counts[key] = value;
  }

  const findings: AuditFinding[] = [];
  const tally = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const [key, value] of Object.entries(vulnerabilities)) {
    const finding = parseFinding(key, value);
    if (!finding) {
      return { kind: "unavailable", reason: `npm audit finding "${key}" has an unsupported structure.` };
    }
    findings.push(finding);
    tally[finding.severity] += 1;
  }

  const listed = AUDIT_SEVERITIES.reduce((sum, severity) => sum + tally[severity], 0);
  const declared = AUDIT_SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
  if (
    AUDIT_SEVERITIES.some((severity) => tally[severity] !== counts[severity]) ||
    counts.total !== declared ||
    listed !== counts.total
  ) {
    return {
      kind: "unavailable",
      reason: "npm audit report is incomplete: listed findings do not match its metadata counts.",
    };
  }

  return { kind: "report", report: { findings, counts } };
}

/** Parses raw CLI output; empty or non-JSON output is unavailable. */
export function parseNpmAuditOutput(stdout: string): NpmAuditParseResult {
  const text = stdout.trim();
  if (!text) {
    return { kind: "unavailable", reason: "npm audit produced no output." };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { kind: "unavailable", reason: "npm audit output is not valid JSON (empty, truncated or corrupted)." };
  }
  return parseNpmAuditPayload(payload);
}

export function advisoryIdFromUrl(url: string): string | null {
  const match = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/.exec(url);
  return match ? match[1]! : null;
}
