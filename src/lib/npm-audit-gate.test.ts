import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { MAX_AUDIT_ATTEMPTS, runAuditGate, type AuditGateDeps, type AuditRun } from "./npm-audit-gate";
import { parseAuditExceptionPolicy } from "./npm-audit-exceptions";

/* eslint-disable @typescript-eslint/no-explicit-any */

const root = process.cwd();
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(root, "src/lib/__fixtures__/npm-audit", name), "utf8"));
const committed = (name: string) => JSON.parse(readFileSync(path.join(root, "security", name), "utf8"));

const NOW = new Date("2026-10-10T12:00:00Z");
const PROPOSAL = committed("npm-audit-exception-proposals.json").proposals[0];

/** Synthetic approval used only by tests; it is not real approval evidence. */
function approvedBraces(overrides: Record<string, unknown> = {}) {
  return {
    ...PROPOSAL,
    status: "approved",
    approval: {
      approvedBy: "synthetic-test-approver",
      approvedAt: "2026-10-05T09:00:00Z",
      reference: "https://example.test/synthetic-approval/1",
    },
    ...overrides,
  };
}

function policy(...exceptions: unknown[]) {
  return JSON.stringify({ schemaVersion: 1, exceptions });
}

function recount(report: any) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } as Record<string, number>;
  for (const finding of Object.values<any>(report.vulnerabilities)) counts[finding.severity]! += 1;
  report.metadata.vulnerabilities = { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  return report;
}

function run(report: unknown, exitCode: number | null = 1): AuditRun {
  return { stdout: JSON.stringify(report), exitCode };
}

function gate(options: {
  runs?: AuditRun[];
  report?: unknown;
  activePolicy?: string;
  lockfile?: unknown;
  now?: Date;
}) {
  const runs = options.runs ?? [run(options.report ?? fixture("report-2026-10-03.json"))];
  const runAudit = vi.fn(() => runs[Math.min(runAudit.mock.calls.length - 1, runs.length - 1)]!);
  const sleep = vi.fn();
  const deps: AuditGateDeps = {
    runAudit,
    sleep,
    readActivePolicy: () => options.activePolicy ?? policy(),
    readLockfile: () => JSON.stringify(options.lockfile ?? fixture("lockfile-2026-10-03.json")),
    now: () => options.now ?? NOW,
  };
  return { result: runAuditGate(deps), runAudit, sleep };
}

const HIGH_PACKAGES = ["@next/eslint-plugin-next", "braces", "eslint-config-next", "fast-glob", "micromatch"];

function linesFor(lines: string[], label: string) {
  return lines.filter((line) => line.startsWith(label));
}

describe("committed policy files", () => {
  it("ship a valid active list whose entries are exactly an approved proposal", () => {
    const parsed = parseAuditExceptionPolicy(committed("npm-audit-exceptions.json"), new Date());
    expect(parsed.kind).toBe("policy");
    if (parsed.kind !== "policy") return;
    const proposals = committed("npm-audit-exception-proposals.json").proposals;
    for (const { status, approval, ...scope } of parsed.policy.exceptions) {
      expect(status).toBe("approved");
      expect(approval.reference).toMatch(/^https:\/\/github\.com\/niteshrajgopal-dev\/qos-app\//);
      const { status: _proposed, approval: _none, ...proposedScope } = proposals.find((p: any) => p.id === scope.id);
      void _proposed;
      void _none;
      expect(scope).toEqual(proposedScope);
    }
  });

  it("keep the braces record proposed, without approval evidence, and unusable as an active exception", () => {
    const proposals = committed("npm-audit-exception-proposals.json").proposals;
    expect(proposals).toHaveLength(1);
    expect(PROPOSAL).toMatchObject({ status: "proposed", approval: null, expiresAt: "2026-11-03T23:59:59Z" });
    expect(parseAuditExceptionPolicy({ schemaVersion: 1, exceptions: proposals }, NOW).kind).toBe("invalid");
  });
});

describe("runAuditGate with the captured report", () => {
  it("fails today: the proposal does not suppress any real finding", () => {
    const { result } = gate({});
    expect(result).toMatchObject({ outcome: "blocked", exitCode: 1 });
    expect(linesFor(result.lines, "BLOCKING high").map((line) => line.split(" ")[2])).toEqual(HIGH_PACKAGES);
    expect(result.lines.join("\n")).toContain("GHSA-vfj7-8cjw-p6xm: no active approved exception");
  });

  it("fails as invalid policy if the proposed record is copied into the active list unchanged", () => {
    const { result, runAudit } = gate({ activePolicy: policy(PROPOSAL) });
    expect(result).toMatchObject({ outcome: "invalid_policy", exitCode: 1 });
    expect(runAudit).not.toHaveBeenCalled();
  });

  it("accepts exactly the approved scope and says so explicitly, keeping every finding visible", () => {
    const { result } = gate({ activePolicy: policy(approvedBraces()) });
    expect(result).toMatchObject({ outcome: "accepted_with_exceptions", exitCode: 0 });
    expect(linesFor(result.lines, "EXCEPTED high").map((line) => line.split(" ")[2])).toEqual(HIGH_PACKAGES);
    expect(linesFor(result.lines, "EXCEPTED high").every((line) => line.includes("npm-audit-2026-001"))).toBe(true);
    expect(linesFor(result.lines, "REPORTED moderate")).toHaveLength(8);
    const summary = result.lines.at(-1)!;
    expect(summary).toContain("PASSED WITH APPROVED EXCEPTIONS");
    expect(summary).toContain("not a clean audit");
    expect(result.lines.join("\n")).not.toMatch(/zero vulnerabilities|no high or critical/i);
  });

  it("still fails on an unrelated high advisory", () => {
    const report = fixture("report-2026-10-03.json");
    report.vulnerabilities["other-lib"] = {
      name: "other-lib",
      severity: "high",
      isDirect: true,
      via: [
        { source: 1, name: "other-lib", dependency: "other-lib", title: "Other", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "high", range: "*" },
      ],
      effects: [],
      range: "*",
      nodes: ["node_modules/other-lib"],
      fixAvailable: false,
    };
    const { result } = gate({ report: recount(report), activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    expect(linesFor(result.lines, "BLOCKING")).toHaveLength(1);
    expect(linesFor(result.lines, "BLOCKING")[0]).toContain("other-lib");
    expect(linesFor(result.lines, "EXCEPTED")).toHaveLength(5);
  });

  it("fails on a critical advisory and never excepts it", () => {
    const report = fixture("report-2026-10-03.json");
    report.vulnerabilities.braces.severity = "critical";
    report.vulnerabilities.braces.via[0].severity = "critical";
    const { result } = gate({ report: recount(report), activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    expect(result.lines.join("\n")).toContain("critical findings cannot be excepted");
  });

  it("fails when the same advisory is reachable through another dependency path", () => {
    const lockfile = fixture("lockfile-2026-10-03.json");
    lockfile.packages[""].devDependencies["glob-tool"] = "1.0.0";
    lockfile.packages["node_modules/glob-tool"] = { version: "1.0.0", dev: true, dependencies: { micromatch: "^4.0.8" } };
    const { result } = gate({ lockfile, activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    expect(result.lines.join("\n")).toContain("path not covered: glob-tool@1.0.0 > micromatch@4.0.8 > braces@3.0.3");
  });

  it("fails when the approved path is a runtime dependency instead of development-only", () => {
    const lockfile = fixture("lockfile-2026-10-03.json");
    const rootEntry = lockfile.packages[""];
    rootEntry.dependencies["eslint-config-next"] = rootEntry.devDependencies["eslint-config-next"];
    delete rootEntry.devDependencies["eslint-config-next"];
    for (const name of ["eslint-config-next", "@next/eslint-plugin-next", "fast-glob", "micromatch", "braces"]) {
      delete lockfile.packages[`node_modules/${name}`].dev;
    }
    const { result } = gate({ lockfile, activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    expect(result.lines.join("\n")).toContain("path is not development-only");
  });

  it("fails when the vulnerable or an ancestor package version changes", () => {
    const changedLeaf = fixture("lockfile-2026-10-03.json");
    changedLeaf.packages["node_modules/braces"].version = "3.0.2";
    expect(gate({ lockfile: changedLeaf, activePolicy: policy(approvedBraces()) }).result.lines.join("\n")).toContain(
      "braces@3.0.2 at node_modules/braces is not the excepted version",
    );

    const changedAncestor = fixture("lockfile-2026-10-03.json");
    changedAncestor.packages["node_modules/fast-glob"].version = "3.3.2";
    const { result } = gate({ lockfile: changedAncestor, activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    expect(result.lines.join("\n")).toContain("path not covered: eslint-config-next@16.3.8 > @next/eslint-plugin-next@16.3.8 > fast-glob@3.3.2");
  });

  it("fails an ancestor that has an additional, uncovered advisory cause", () => {
    const report = fixture("report-2026-10-03.json");
    report.vulnerabilities.micromatch.via.push({
      source: 2,
      name: "micromatch",
      dependency: "micromatch",
      title: "Synthetic second cause",
      url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
      severity: "high",
      range: "<=4.0.8",
    });
    const { result } = gate({ report, activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    const blocked = linesFor(result.lines, "BLOCKING").map((line) => line.split(" ")[2]);
    expect(blocked).toEqual(["@next/eslint-plugin-next", "eslint-config-next", "fast-glob", "micromatch"]);
    expect(linesFor(result.lines, "EXCEPTED high braces")).toHaveLength(1);
  });

  it("stops applying an exception at exactly its expiry instant", () => {
    const exception = approvedBraces();
    const before = gate({ activePolicy: policy(exception), now: new Date("2026-11-03T23:59:58Z") });
    expect(before.result.outcome).toBe("accepted_with_exceptions");
    const atExpiry = gate({ activePolicy: policy(exception), now: new Date("2026-11-03T23:59:59Z") });
    expect(atExpiry.result.outcome).toBe("blocked");
    expect(atExpiry.result.lines.join("\n")).toContain("exception npm-audit-2026-001 expired at 2026-11-03T23:59:59Z");
    expect(atExpiry.result.warnings.join("\n")).toContain("expired");
  });

  it("rejects malformed exceptions and missing approval evidence before auditing", () => {
    const { approval: _omit, ...withoutApproval } = approvedBraces();
    void _omit;
    const malformed = [
      withoutApproval,
      approvedBraces({ approval: null }),
      approvedBraces({ approval: { approvedBy: "x", approvedAt: "2026-10-05T09:00:00Z" } }),
      approvedBraces({ approval: { approvedBy: "x", approvedAt: "2026-10-05T09:00:00+04:00", reference: "https://example.test/a" } }),
      approvedBraces({ approval: { approvedBy: "x", approvedAt: "2026-10-11T00:00:00Z", reference: "https://example.test/a" } }),
      approvedBraces({ advisory: "GHSA-*" }),
      approvedBraces({ package: { name: "braces", version: "^3.0.3" } }),
      approvedBraces({ package: { name: "brace*", version: "3.0.3" } }),
      approvedBraces({ path: ["micromatch@4.0.8"] }),
      approvedBraces({ path: ["eslint-config-next@*", "braces@3.0.3"] }),
      approvedBraces({ scope: "production" }),
      approvedBraces({ expiresAt: "2026-11-03" }),
      approvedBraces({ expiresAt: "2027-06-01T00:00:00Z" }),
      approvedBraces({ reviewBy: "2026-12-01" }),
      approvedBraces({ removalConditions: [] }),
      approvedBraces({ extra: true }),
    ];
    for (const exception of malformed) {
      const { result, runAudit } = gate({ activePolicy: policy(exception) });
      expect(result.outcome, JSON.stringify(exception).slice(0, 120)).toBe("invalid_policy");
      expect(result.exitCode).toBe(1);
      expect(runAudit).not.toHaveBeenCalled();
    }
    expect(gate({ activePolicy: policy(approvedBraces(), approvedBraces()) }).result.outcome).toBe("invalid_policy");
    expect(gate({ activePolicy: "{ not json" }).result.outcome).toBe("invalid_policy");
  });

  it("applies no exception when the lockfile cannot establish ancestry", () => {
    const { result } = gate({ lockfile: { lockfileVersion: 1, dependencies: {} }, activePolicy: policy(approvedBraces()) });
    expect(result.outcome).toBe("blocked");
    expect(result.warnings.join("\n")).toContain("lockfileVersion 2 or 3");
  });

  it("warns about an approved exception that no longer matches anything", () => {
    const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };
    const { result } = gate({ report: clean, activePolicy: policy(approvedBraces()), runs: [run(clean, 0)] });
    expect(result.outcome).toBe("clean");
    expect(result.warnings.join("\n")).toContain("matched no finding");
  });
});

describe("runAuditGate when the audit cannot be completed", () => {
  const clean = {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  };

  it.each([
    ["registry error response", { stdout: JSON.stringify({ error: { code: "E503", summary: "Service Unavailable" } }), exitCode: 1 }],
    ["retired endpoint response", { stdout: JSON.stringify({ statusCode: 400, error: "Bad Request", message: "Invalid package tree" }), exitCode: 1 }],
    ["timeout", { stdout: "", exitCode: null, failure: "timeout" as const }],
    ["spawn failure", { stdout: "", exitCode: null, failure: "spawn_error" as const }],
    ["empty output", { stdout: "", exitCode: 1 }],
    ["truncated output", { stdout: JSON.stringify(fixture("report-2026-10-03.json")).slice(0, 2_000), exitCode: 1 }],
    ["invalid JSON", { stdout: "npm ERR! code ECONNRESET", exitCode: 1 }],
    ["unsupported structure", { stdout: JSON.stringify({ auditReportVersion: 3 }), exitCode: 1 }],
    ["non-zero exit with a clean report", { stdout: JSON.stringify(clean), exitCode: 1 }],
  ])("fails closed after bounded retries: %s", (_label, attempt) => {
    const { result, runAudit, sleep } = gate({ runs: [attempt as AuditRun] });
    expect(result).toMatchObject({ outcome: "verification_unavailable", exitCode: 1 });
    expect(result.lines[0]).toContain("Security verification unavailable");
    expect(result.lines.join("\n")).toContain("not a clean audit and not evidence of a vulnerability");
    expect(runAudit).toHaveBeenCalledTimes(MAX_AUDIT_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(MAX_AUDIT_ATTEMPTS - 1);
  });

  it("uses a valid report from a later attempt and does not retry after it", () => {
    const { result, runAudit } = gate({
      runs: [{ stdout: "", exitCode: null, failure: "timeout" }, run(fixture("report-2026-10-03.json"), 1)],
    });
    expect(result.outcome).toBe("blocked");
    expect(runAudit).toHaveBeenCalledTimes(2);
  });

  it("analyses a valid report delivered with npm's non-zero findings exit code", () => {
    const { result, runAudit } = gate({ runs: [run(fixture("report-2026-10-03.json"), 1)] });
    expect(result.outcome).toBe("blocked");
    expect(runAudit).toHaveBeenCalledTimes(1);
  });

  it("passes a clean report with exit code 0", () => {
    const { result } = gate({ runs: [run(clean, 0)] });
    expect(result).toMatchObject({ outcome: "clean", exitCode: 0 });
    expect(result.lines.at(-1)).toBe("Result: PASSED — no high or critical findings.");
  });

  it("reports moderate findings without failing under the existing high threshold", () => {
    const report = fixture("report-2026-10-03.json");
    for (const name of HIGH_PACKAGES) delete report.vulnerabilities[name];
    const { result } = gate({ runs: [run(recount(report), 0)] });
    expect(result.outcome).toBe("clean");
    expect(linesFor(result.lines, "REPORTED moderate")).toHaveLength(8);
  });
});
