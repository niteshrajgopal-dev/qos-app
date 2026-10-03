import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { advisoryIdFromUrl, parseNpmAuditOutput, parseNpmAuditPayload } from "./npm-audit-report";

const capturedReport = () =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "src/lib/__fixtures__/npm-audit/report-2026-10-03.json"), "utf8"),
  ) as Record<string, unknown> & { vulnerabilities: Record<string, unknown> };

describe("parseNpmAuditPayload", () => {
  it("accepts a complete captured npm 10 report and keeps every finding", () => {
    const parsed = parseNpmAuditPayload(capturedReport());
    expect(parsed.kind).toBe("report");
    if (parsed.kind !== "report") return;
    expect(parsed.report.counts).toMatchObject({ high: 5, moderate: 8, critical: 0, total: 13 });
    expect(parsed.report.findings).toHaveLength(13);
    expect(parsed.report.findings.find((finding) => finding.name === "braces")?.via[0]).toMatchObject({
      dependency: "braces",
      url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
      severity: "high",
    });
  });

  it("accepts a clean report", () => {
    const parsed = parseNpmAuditPayload({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    });
    expect(parsed).toEqual({
      kind: "report",
      report: { findings: [], counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    });
  });

  it("treats npm error objects and retired endpoint responses as unavailable, not clean", () => {
    for (const payload of [
      { error: { code: "E503", summary: "Service Unavailable", detail: "registry maintenance" } },
      { statusCode: 400, error: "Bad Request", message: "Invalid package tree, run  npm install  to rebuild your package-lock.json" },
      { error: "We are currently performing maintenance. For more info go to https://status.npmjs.org" },
    ]) {
      const parsed = parseNpmAuditPayload(payload);
      expect(parsed.kind).toBe("unavailable");
      if (parsed.kind === "unavailable") expect(parsed.reason).toContain("error instead of a report");
    }
  });

  it("rejects unsupported structures", () => {
    expect(parseNpmAuditPayload(null).kind).toBe("unavailable");
    expect(parseNpmAuditPayload({}).kind).toBe("unavailable");
    expect(parseNpmAuditPayload({ auditReportVersion: 1, advisories: {} }).kind).toBe("unavailable");
    const report = capturedReport();
    (report.vulnerabilities.braces as Record<string, unknown>).via = [{ url: "x" }];
    expect(parseNpmAuditPayload(report).kind).toBe("unavailable");
  });

  it("rejects a report whose findings do not match its metadata counts", () => {
    const report = capturedReport();
    delete report.vulnerabilities.micromatch;
    const parsed = parseNpmAuditPayload(report);
    expect(parsed).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("incomplete") });
  });
});

describe("parseNpmAuditOutput", () => {
  it("treats empty, truncated and invalid JSON output as unavailable", () => {
    const full = JSON.stringify(capturedReport());
    for (const stdout of ["", "   ", full.slice(0, full.length / 2), "npm ERR! network"]) {
      expect(parseNpmAuditOutput(stdout).kind).toBe("unavailable");
    }
    expect(parseNpmAuditOutput(full).kind).toBe("report");
  });
});

describe("advisoryIdFromUrl", () => {
  it("extracts only exact GitHub advisory URLs", () => {
    expect(advisoryIdFromUrl("https://github.com/advisories/GHSA-vfj7-8cjw-p6xm")).toBe("GHSA-vfj7-8cjw-p6xm");
    expect(advisoryIdFromUrl("https://github.com/advisories/GHSA-vfj7-8cjw-p6xm/extra")).toBeNull();
    expect(advisoryIdFromUrl("https://example.test/GHSA-vfj7-8cjw-p6xm")).toBeNull();
  });
});
