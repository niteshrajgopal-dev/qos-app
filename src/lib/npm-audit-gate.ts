import {
  evaluateAuditReport,
  LockfileGraph,
  parseAuditExceptionPolicy,
  type AuditEvaluation,
} from "./npm-audit-exceptions";
import { parseNpmAuditOutput, type NpmAuditReport } from "./npm-audit-report";

export const MAX_AUDIT_ATTEMPTS = 3;

export type AuditRun = {
  stdout: string;
  exitCode: number | null;
  /** Set when the process could not run or was killed (including timeouts). */
  failure?: "timeout" | "spawn_error";
};

export type AuditGateDeps = {
  runAudit: () => AuditRun;
  readActivePolicy: () => string;
  readLockfile: () => string;
  sleep: (ms: number) => void;
  now: () => Date;
};

export type AuditGateOutcome =
  | "clean"
  | "accepted_with_exceptions"
  | "blocked"
  | "verification_unavailable"
  | "invalid_policy";

export type AuditGateResult = {
  outcome: AuditGateOutcome;
  exitCode: 0 | 1;
  lines: string[];
  warnings: string[];
};

function parseJson(text: string, label: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${label} is not valid JSON.` };
  }
}

function obtainReport(deps: AuditGateDeps, warnings: string[]): { report: NpmAuditReport } | { reason: string } {
  let reason = "npm audit was not attempted.";
  for (let attempt = 1; attempt <= MAX_AUDIT_ATTEMPTS; attempt += 1) {
    const run = deps.runAudit();
    if (run.failure === "timeout") {
      reason = "npm audit timed out.";
    } else if (run.failure === "spawn_error") {
      reason = "npm audit could not be started.";
    } else {
      const parsed = parseNpmAuditOutput(run.stdout);
      if (parsed.kind === "report") {
        const blockingLevel = parsed.report.counts.high + parsed.report.counts.critical;
        if (run.exitCode === 0 || (run.exitCode === 1 && blockingLevel > 0)) {
          return { report: parsed.report };
        }
        reason = `npm audit exited ${String(run.exitCode)} with a report that does not explain that exit code.`;
      } else {
        reason = parsed.reason;
      }
    }
    if (attempt < MAX_AUDIT_ATTEMPTS) {
      warnings.push(`npm audit attempt ${attempt}/${MAX_AUDIT_ATTEMPTS} failed (${reason}) Retrying.`);
      deps.sleep(5_000 * attempt);
    }
  }
  return { reason };
}

function describeFindings(evaluation: AuditEvaluation): string[] {
  const order = { blocking: 0, excepted: 1, informational: 2 } as const;
  return [...evaluation.findings]
    .sort((a, b) => order[a.status] - order[b.status] || a.finding.name.localeCompare(b.finding.name))
    .map(({ finding, status, advisories, exceptionIds, reasons }) => {
      const label = status === "blocking" ? "BLOCKING" : status === "excepted" ? "EXCEPTED" : "REPORTED";
      const inherited = finding.via.filter((cause): cause is string => typeof cause === "string");
      const causes = [...advisories, ...inherited.map((name) => `via ${name}`)].join(", ");
      const detail =
        status === "excepted"
          ? ` [approved exception ${exceptionIds.join(", ")}]`
          : reasons.length > 0
            ? ` [${reasons.join("; ")}]`
            : "";
      return `${label} ${finding.severity} ${finding.name} (${finding.nodes.join(", ") || "no location"}): ${causes}${detail}`;
    });
}

/**
 * The CI dependency-security gate. Exits non-zero unless a complete, valid
 * audit report shows no critical finding and every high finding is either
 * absent or covered by an active, approved, exactly-scoped exception.
 */
export function runAuditGate(deps: AuditGateDeps): AuditGateResult {
  const warnings: string[] = [];
  const now = deps.now();

  let policyText: string;
  try {
    policyText = deps.readActivePolicy();
  } catch {
    return { outcome: "invalid_policy", exitCode: 1, lines: ["Invalid audit exception policy: the active exception file could not be read."], warnings };
  }
  const policyJson = parseJson(policyText, "the active exception file");
  const policy =
    "error" in policyJson
      ? ({ kind: "invalid", reason: policyJson.error } as const)
      : parseAuditExceptionPolicy(policyJson.value, now);
  if (policy.kind === "invalid") {
    return { outcome: "invalid_policy", exitCode: 1, lines: [`Invalid audit exception policy: ${policy.reason}`], warnings };
  }

  const obtained = obtainReport(deps, warnings);
  if ("reason" in obtained) {
    return {
      outcome: "verification_unavailable",
      exitCode: 1,
      lines: [
        `Security verification unavailable after ${MAX_AUDIT_ATTEMPTS} attempts: ${obtained.reason}`,
        "This is not a clean audit and not evidence of a vulnerability; the dependency audit did not complete.",
      ],
      warnings,
    };
  }
  const { report } = obtained;

  let graph: LockfileGraph | null = null;
  const needsGraph = report.counts.high > 0 && policy.policy.exceptions.length > 0;
  if (needsGraph) {
    let lockText: string | null = null;
    try {
      lockText = deps.readLockfile();
    } catch {
      warnings.push("package-lock.json could not be read; no exception can be applied.");
    }
    if (lockText !== null) {
      const lockJson = parseJson(lockText, "package-lock.json");
      const parsed = "error" in lockJson ? { error: lockJson.error } : LockfileGraph.parse(lockJson.value);
      if (parsed instanceof LockfileGraph) {
        graph = parsed;
      } else {
        warnings.push(`${parsed.error} No exception can be applied.`);
      }
    }
  }

  const evaluation = evaluateAuditReport(report, policy.policy, graph, now);
  const { counts } = report;
  const lines = [
    `npm audit: ${counts.total} finding(s) — critical=${counts.critical} high=${counts.high} moderate=${counts.moderate} low=${counts.low} info=${counts.info}.`,
    ...describeFindings(evaluation),
  ];
  for (const exception of evaluation.expiredExceptions) {
    warnings.push(`Exception ${exception.id} (${exception.advisory}) expired at ${exception.expiresAt}; remove it from the active list.`);
  }
  for (const exception of evaluation.unusedExceptions) {
    warnings.push(`Exception ${exception.id} (${exception.advisory}) matched no finding; verify the path is gone and remove it.`);
  }

  const blocking = evaluation.findings.filter((item) => item.status === "blocking");
  const excepted = evaluation.findings.filter((item) => item.status === "excepted");
  if (blocking.length > 0) {
    lines.push(`Result: FAILED — ${blocking.length} high/critical finding(s) are not covered by an active approved exception.`);
    return { outcome: "blocked", exitCode: 1, lines, warnings };
  }
  if (excepted.length > 0) {
    const ids = [...new Set(excepted.flatMap((item) => item.exceptionIds))].join(", ");
    lines.push(
      `Result: PASSED WITH APPROVED EXCEPTIONS — ${excepted.length} high finding(s) accepted under ${ids}. This is recorded risk acceptance, not a clean audit.`,
    );
    return { outcome: "accepted_with_exceptions", exitCode: 0, lines, warnings };
  }
  lines.push("Result: PASSED — no high or critical findings.");
  return { outcome: "clean", exitCode: 0, lines, warnings };
}
