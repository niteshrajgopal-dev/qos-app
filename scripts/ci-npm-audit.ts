import { spawnSync } from "node:child_process";

import {
  classifyNpmAuditPayload,
  describeNpmAuditClassification,
} from "../src/lib/npm-audit-report";

const MAX_ATTEMPTS = 3;

function runNpmAuditJson() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["audit", "--json", "--audit-level=high"], {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });

  const stdout = result.stdout?.trim() || "";
  const stderr = result.stderr?.trim() || "";

  try {
    return JSON.parse(stdout || stderr);
  } catch {
    return {
      error:
        stderr ||
        stdout ||
        result.error?.message ||
        `npm audit exited ${result.status ?? "unknown"}`,
    };
  }
}

function sleepSync(ms: number) {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`]);
}

function main() {
  let payload: unknown;
  let classification = "unreadable" as ReturnType<
    typeof classifyNpmAuditPayload
  >;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    payload = runNpmAuditJson();
    classification = classifyNpmAuditPayload(payload);

    if (classification !== "unreachable" || attempt === MAX_ATTEMPTS) {
      break;
    }

    console.warn(
      `npm audit attempt ${attempt}/${MAX_ATTEMPTS} could not reach the advisory API; retrying...`,
    );
    sleepSync(5_000 * attempt);
  }

  const message = describeNpmAuditClassification(classification, payload);
  if (classification === "clean") {
    console.log(message);
    return;
  }

  if (classification === "unreachable") {
    console.warn(`::warning::${message} High/critical findings were not audited this run.`);
    return;
  }

  console.error(message);
  process.exitCode = 1;
}

main();
