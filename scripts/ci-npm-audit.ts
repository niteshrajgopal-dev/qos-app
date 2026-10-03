import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runAuditGate, type AuditRun } from "../src/lib/npm-audit-gate";

const AUDIT_TIMEOUT_MS = 120_000;
const ROOT = path.resolve(__dirname, "..");

function runNpmAuditJson(): AuditRun {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["audit", "--json", "--audit-level=high"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
    timeout: AUDIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return { stdout: "", exitCode: null, failure: code === "ETIMEDOUT" ? "timeout" : "spawn_error" };
  }
  if (result.signal) {
    return { stdout: "", exitCode: null, failure: "timeout" };
  }
  return { stdout: result.stdout ?? "", exitCode: result.status };
}

function sleepSync(ms: number) {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`]);
}

function main() {
  const result = runAuditGate({
    runAudit: runNpmAuditJson,
    readActivePolicy: () => readFileSync(path.join(ROOT, "security", "npm-audit-exceptions.json"), "utf8"),
    readLockfile: () => readFileSync(path.join(ROOT, "package-lock.json"), "utf8"),
    sleep: sleepSync,
    now: () => new Date(),
  });

  for (const warning of result.warnings) {
    console.warn(`::warning::${warning}`);
  }
  const print = result.exitCode === 0 ? console.log : console.error;
  for (const line of result.lines) {
    print(line);
  }
  process.exitCode = result.exitCode;
}

main();
