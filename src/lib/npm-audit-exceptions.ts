import { z } from "zod";

import {
  advisoryIdFromUrl,
  type AuditAdvisoryCause,
  type AuditFinding,
  type NpmAuditReport,
} from "./npm-audit-report";

const MAX_EXCEPTION_DAYS = 90;
const MAX_PATHS_PER_NODE = 200;
const MAX_SEARCH_STEPS = 100_000;

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PATH_ENTRY = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

const utcTimestamp = z
  .string()
  .regex(UTC_TIMESTAMP, "must be a UTC timestamp like 2026-11-03T23:59:59Z")
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a real date");

const approvedExceptionSchema = z
  .object({
    id: z.string().regex(/^npm-audit-\d{4}-\d{3}$/),
    status: z.literal("approved"),
    advisory: z.string().regex(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/),
    cve: z.string().regex(/^CVE-\d{4}-\d{4,}$/).optional(),
    package: z.object({ name: z.string().regex(PACKAGE_NAME), version: z.string().regex(EXACT_VERSION) }).strict(),
    scope: z.literal("development"),
    path: z.array(z.string().regex(PATH_ENTRY)).min(1),
    rationale: z.string().trim().min(20),
    exposureEvidence: z.string().trim().min(20),
    owner: z.string().trim().min(1),
    approval: z
      .object({
        approvedBy: z.string().trim().min(1),
        approvedAt: utcTimestamp,
        reference: z.string().regex(/^https:\/\/\S+$/, "must link to the recorded approval"),
      })
      .strict(),
    expiresAt: utcTimestamp,
    reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    removalConditions: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((exception, ctx) => {
    const last = exception.path[exception.path.length - 1];
    if (last !== `${exception.package.name}@${exception.package.version}`) {
      ctx.addIssue({ code: "custom", path: ["path"], message: "must end with the exact vulnerable package@version" });
    }
    if (new Set(exception.path).size !== exception.path.length) {
      ctx.addIssue({ code: "custom", path: ["path"], message: "must not repeat a package" });
    }
    const approvedAt = Date.parse(exception.approval.approvedAt);
    const expiresAt = Date.parse(exception.expiresAt);
    if (expiresAt <= approvedAt) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "must be after approval" });
    }
    if (expiresAt - approvedAt > MAX_EXCEPTION_DAYS * 86_400_000) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: `must be within ${MAX_EXCEPTION_DAYS} days of approval` });
    }
    const reviewBy = Date.parse(`${exception.reviewBy}T00:00:00Z`);
    if (Number.isNaN(reviewBy) || reviewBy > expiresAt) {
      ctx.addIssue({ code: "custom", path: ["reviewBy"], message: "must be a real date on or before expiry" });
    }
  });

const exceptionPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    exceptions: z.array(approvedExceptionSchema),
  })
  .strict();

export type ApprovedAuditException = z.infer<typeof approvedExceptionSchema>;
export type AuditExceptionPolicy = { exceptions: ApprovedAuditException[] };

export type PolicyParseResult =
  | { kind: "policy"; policy: AuditExceptionPolicy }
  | { kind: "invalid"; reason: string };

/**
 * Validates the active exception list. Only fully approved, exact-scope records
 * are accepted; a proposed record, a missing approval, an approval in the
 * future or any unknown field makes the whole policy invalid.
 */
export function parseAuditExceptionPolicy(payload: unknown, now: Date): PolicyParseResult {
  const parsed = exceptionPolicySchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "(root)";
    return { kind: "invalid", reason: `${where}: ${issue?.message ?? "invalid"}` };
  }
  const ids = new Set<string>();
  for (const exception of parsed.data.exceptions) {
    if (ids.has(exception.id)) {
      return { kind: "invalid", reason: `exceptions: duplicate id ${exception.id}` };
    }
    ids.add(exception.id);
    if (Date.parse(exception.approval.approvedAt) > now.getTime()) {
      return { kind: "invalid", reason: `${exception.id}: approval timestamp is in the future` };
    }
  }
  return { kind: "policy", policy: { exceptions: parsed.data.exceptions } };
}

export function isExceptionActive(exception: ApprovedAuditException, now: Date) {
  return now.getTime() < Date.parse(exception.expiresAt);
}

type LockEntry = {
  name: string;
  version: string;
  dev: boolean;
  dependencies: string[];
  devDependencies: string[];
};

type DependencyPath = { packages: string[]; developmentOnly: boolean };

/**
 * Dependency ancestry from a package-lock (v2/v3), resolved with Node's
 * nearest-node_modules lookup so a hoisted location is never mistaken for its
 * dependents.
 */
export class LockfileGraph {
  private readonly entries = new Map<string, LockEntry>();
  private readonly parents = new Map<string, Array<{ location: string; viaDevEdge: boolean }>>();

  private constructor() {}

  static parse(payload: unknown): LockfileGraph | { error: string } {
    const lock = payload as { lockfileVersion?: unknown; packages?: Record<string, Record<string, unknown>> };
    if (!lock || typeof lock !== "object" || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3)) {
      return { error: "package-lock.json must be lockfileVersion 2 or 3." };
    }
    if (!lock.packages || typeof lock.packages !== "object" || !lock.packages[""]) {
      return { error: "package-lock.json has no packages map with a root entry." };
    }
    const graph = new LockfileGraph();
    for (const [location, raw] of Object.entries(lock.packages)) {
      if (raw.link === true) {
        return { error: `package-lock.json contains a linked package (${location}); ancestry is not supported.` };
      }
      const name = typeof raw.name === "string" ? raw.name : location.slice(location.lastIndexOf("node_modules/") + 13);
      const keys = (field: string) =>
        raw[field] && typeof raw[field] === "object" ? Object.keys(raw[field] as object) : [];
      graph.entries.set(location, {
        name: location === "" ? "" : name,
        version: typeof raw.version === "string" ? raw.version : "",
        dev: raw.dev === true,
        dependencies: [...keys("dependencies"), ...keys("optionalDependencies"), ...keys("peerDependencies")],
        devDependencies: location === "" ? keys("devDependencies") : [],
      });
    }
    for (const [location, entry] of graph.entries) {
      const runtime = new Set(entry.dependencies);
      for (const dependency of new Set([...entry.dependencies, ...entry.devDependencies])) {
        const resolved = graph.resolve(location, dependency);
        if (resolved === null) {
          continue;
        }
        const viaDevEdge = location === "" && !runtime.has(dependency);
        const list = graph.parents.get(resolved) ?? [];
        list.push({ location, viaDevEdge });
        graph.parents.set(resolved, list);
      }
    }
    return graph;
  }

  private resolve(from: string, dependency: string): string | null {
    let base = from;
    for (;;) {
      const candidate = `${base ? `${base}/` : ""}node_modules/${dependency}`;
      if (this.entries.has(candidate)) {
        return candidate;
      }
      if (base === "") {
        return null;
      }
      const index = base.lastIndexOf("node_modules/");
      base = index <= 0 ? "" : base.slice(0, index - 1);
    }
  }

  version(location: string) {
    return this.entries.get(location)?.version ?? null;
  }

  /** Every root-to-node path, or null when it cannot be enumerated exhaustively. */
  pathsTo(location: string): DependencyPath[] | null {
    if (!this.entries.has(location)) {
      return null;
    }
    const results: DependencyPath[] = [];
    let steps = 0;
    let overflow = false;
    const walk = (current: string, chain: string[], locations: string[]) => {
      for (const parent of this.parents.get(current) ?? []) {
        steps += 1;
        if (overflow || steps > MAX_SEARCH_STEPS) {
          overflow = true;
          return;
        }
        if (parent.location === "") {
          results.push({
            packages: chain,
            developmentOnly: parent.viaDevEdge && locations.every((loc) => this.entries.get(loc)?.dev === true),
          });
          if (results.length > MAX_PATHS_PER_NODE) {
            overflow = true;
            return;
          }
          continue;
        }
        if (locations.includes(parent.location)) {
          continue;
        }
        const entry = this.entries.get(parent.location)!;
        walk(parent.location, [`${entry.name}@${entry.version}`, ...chain], [parent.location, ...locations]);
      }
    };
    const target = this.entries.get(location)!;
    walk(location, [`${target.name}@${target.version}`], [location]);
    return overflow ? null : results;
  }
}

export type FindingStatus = "blocking" | "excepted" | "informational";

export type EvaluatedFinding = {
  finding: AuditFinding;
  status: FindingStatus;
  advisories: string[];
  exceptionIds: string[];
  reasons: string[];
};

export type AuditEvaluation = {
  findings: EvaluatedFinding[];
  unusedExceptions: ApprovedAuditException[];
  expiredExceptions: ApprovedAuditException[];
};

type CauseCoverage = { covered: boolean; exceptionIds: string[]; reasons: string[] };

function samePath(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Decides, per finding, whether it blocks. Critical findings always block.
 * A high finding is excepted only when every cause — each advisory on every
 * installed node and every dependency path to it, and every inherited cause —
 * is covered by an active approved exception. Anything that cannot be
 * established is treated as uncovered.
 */
export function evaluateAuditReport(
  report: NpmAuditReport,
  policy: AuditExceptionPolicy,
  graph: LockfileGraph | null,
  now: Date,
): AuditEvaluation {
  const byName = new Map(report.findings.map((finding) => [finding.name, finding]));
  const active = policy.exceptions.filter((exception) => isExceptionActive(exception, now));
  const expired = policy.exceptions.filter((exception) => !isExceptionActive(exception, now));
  const used = new Set<string>();

  const coverAdvisory = (finding: AuditFinding, cause: AuditAdvisoryCause): CauseCoverage => {
    const advisory = advisoryIdFromUrl(cause.url);
    if (!advisory) {
      return { covered: false, exceptionIds: [], reasons: [`advisory URL is not a GitHub advisory ID: ${cause.url}`] };
    }
    if (cause.severity === "critical") {
      return { covered: false, exceptionIds: [], reasons: [`${advisory} is critical; critical findings cannot be excepted`] };
    }
    if (cause.dependency !== finding.name) {
      return { covered: false, exceptionIds: [], reasons: [`${advisory} names ${cause.dependency}, not ${finding.name}`] };
    }
    const candidates = active.filter(
      (exception) => exception.advisory === advisory && exception.package.name === finding.name,
    );
    if (candidates.length === 0) {
      const lapsed = expired.find((exception) => exception.advisory === advisory && exception.package.name === finding.name);
      return {
        covered: false,
        exceptionIds: [],
        reasons: [
          lapsed
            ? `${advisory}: exception ${lapsed.id} expired at ${lapsed.expiresAt}`
            : `${advisory}: no active approved exception`,
        ],
      };
    }
    if (!graph) {
      return { covered: false, exceptionIds: [], reasons: [`${advisory}: dependency graph unavailable`] };
    }
    if (finding.nodes.length === 0) {
      return { covered: false, exceptionIds: [], reasons: [`${advisory}: report lists no installed location`] };
    }
    const ids = new Set<string>();
    const reasons: string[] = [];
    for (const node of finding.nodes) {
      const version = graph.version(node);
      const paths = graph.pathsTo(node);
      if (version === null || paths === null || paths.length === 0) {
        reasons.push(`${advisory}: cannot establish dependency paths to ${node}`);
        continue;
      }
      const versionMatches = candidates.filter((exception) => exception.package.version === version);
      if (versionMatches.length === 0) {
        reasons.push(`${advisory}: ${finding.name}@${version} at ${node} is not the excepted version`);
        continue;
      }
      for (const path of paths) {
        const match = versionMatches.find((exception) => samePath(exception.path, path.packages));
        if (!match) {
          reasons.push(`${advisory}: path not covered: ${path.packages.join(" > ")}`);
        } else if (!path.developmentOnly) {
          reasons.push(`${advisory}: path is not development-only: ${path.packages.join(" > ")}`);
        } else {
          ids.add(match.id);
        }
      }
    }
    if (reasons.length > 0) {
      return { covered: false, exceptionIds: [], reasons };
    }
    return { covered: true, exceptionIds: [...ids], reasons: [] };
  };

  const memo = new Map<string, CauseCoverage>();
  const coverFinding = (finding: AuditFinding, visiting: Set<string>): CauseCoverage => {
    const cached = memo.get(finding.name);
    if (cached) {
      return cached;
    }
    if (visiting.has(finding.name)) {
      return { covered: false, exceptionIds: [], reasons: [`cyclic cause chain through ${finding.name}`] };
    }
    visiting.add(finding.name);
    const ids = new Set<string>();
    const reasons: string[] = [];
    for (const cause of finding.via) {
      const coverage =
        typeof cause === "string"
          ? byName.has(cause)
            ? (() => {
                const inherited = coverFinding(byName.get(cause)!, visiting);
                return inherited.covered
                  ? inherited
                  : { ...inherited, reasons: [`via ${cause}: not fully covered`] };
              })()
            : { covered: false, exceptionIds: [], reasons: [`via ${cause}: cause missing from report`] }
          : coverAdvisory(finding, cause);
      coverage.exceptionIds.forEach((id) => ids.add(id));
      reasons.push(...coverage.reasons);
    }
    visiting.delete(finding.name);
    const result: CauseCoverage =
      reasons.length === 0
        ? { covered: true, exceptionIds: [...ids], reasons: [] }
        : { covered: false, exceptionIds: [], reasons };
    memo.set(finding.name, result);
    return result;
  };

  const findings = report.findings.map((finding): EvaluatedFinding => {
    const advisories = finding.via
      .filter((cause): cause is AuditAdvisoryCause => typeof cause !== "string")
      .map((cause) => advisoryIdFromUrl(cause.url) ?? cause.url);
    if (finding.severity === "critical") {
      return {
        finding,
        status: "blocking",
        advisories,
        exceptionIds: [],
        reasons: ["critical findings cannot be excepted"],
      };
    }
    if (finding.severity !== "high") {
      return { finding, status: "informational", advisories, exceptionIds: [], reasons: [] };
    }
    const coverage = coverFinding(finding, new Set());
    if (coverage.covered) {
      coverage.exceptionIds.forEach((id) => used.add(id));
      return { finding, status: "excepted", advisories, exceptionIds: coverage.exceptionIds, reasons: [] };
    }
    return { finding, status: "blocking", advisories, exceptionIds: [], reasons: coverage.reasons };
  });

  return {
    findings,
    unusedExceptions: active.filter((exception) => !used.has(exception.id)),
    expiredExceptions: expired,
  };
}
