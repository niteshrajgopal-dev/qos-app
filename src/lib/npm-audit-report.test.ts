import { describe, expect, it } from "vitest";

import {
  classifyNpmAuditPayload,
  describeNpmAuditClassification,
} from "./npm-audit-report";

describe("classifyNpmAuditPayload", () => {
  it("treats a completed report with no high or critical findings as clean", () => {
    expect(
      classifyNpmAuditPayload({
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 1,
            moderate: 2,
            high: 0,
            critical: 0,
          },
        },
      }),
    ).toBe("clean");
  });

  it("fails closed on high or critical findings", () => {
    expect(
      classifyNpmAuditPayload({
        metadata: {
          vulnerabilities: { high: 1, critical: 0 },
        },
      }),
    ).toBe("vulnerable");
    expect(
      classifyNpmAuditPayload({
        metadata: {
          vulnerabilities: { high: 0, critical: 1 },
        },
      }),
    ).toBe("vulnerable");
  });

  it("treats the retired quick-audit 400 as unreachable, not a lockfile bug", () => {
    expect(
      classifyNpmAuditPayload({
        statusCode: 400,
        error: "Bad Request",
        message:
          "Invalid package tree, run  npm install  to rebuild your package-lock.json",
      }),
    ).toBe("unreachable");
  });

  it("treats bulk advisory maintenance as unreachable", () => {
    expect(
      classifyNpmAuditPayload({
        error:
          "We are currently performing maintenance. For more info go to https://status.npmjs.org",
      }),
    ).toBe("unreachable");
  });

  it("fails closed on an unreadable payload", () => {
    expect(classifyNpmAuditPayload(null)).toBe("unreadable");
    expect(classifyNpmAuditPayload({})).toBe("unreadable");
    expect(classifyNpmAuditPayload("not-json")).toBe("unreadable");
  });

  it("describes each classification without leaking a lockfile rebuild instruction as the cause", () => {
    const unreachable = {
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid package tree, run  npm install  to rebuild your package-lock.json",
    };

    expect(describeNpmAuditClassification("unreachable", unreachable)).toContain(
      "unavailable",
    );
    expect(describeNpmAuditClassification("clean", {})).toContain("no high");
    expect(
      describeNpmAuditClassification("vulnerable", {
        metadata: { vulnerabilities: { high: 2, critical: 1 } },
      }),
    ).toBe("npm audit found high=2 critical=1.");
    expect(describeNpmAuditClassification("unreadable", {})).toContain(
      "unreadable",
    );
  });
});
