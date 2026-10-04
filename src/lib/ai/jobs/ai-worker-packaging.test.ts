import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AI_SCALER_DB_SECRETS,
  AI_WORKER_BUNDLE_RELATIVE,
  AI_WORKER_DB_SECRETS,
  AI_WORKER_DOCKER_TARGET,
  AI_WORKER_FORBIDDEN_API_DB_SECRETS,
  AI_WORKER_REQUIRED_CAP_ENV,
  AI_WORKER_SCALE_QUERY,
} from "@/lib/ai/jobs/ai-worker-packaging";

const root = process.cwd();

function read(relative: string) {
  return readFileSync(path.join(root, relative), "utf8");
}

function spawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("AI_WORKER_") ||
      key.startsWith("DB_") ||
      key === "DATABASE_URL" ||
      key === "DATABASE_ADMIN_URL"
    ) {
      delete env[key];
    }
  }
  return env;
}

describe("AI worker packaging", () => {
  it("keeps a dedicated image target after the video worker and before the API", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/FROM base AS worker\b/);
    expect(dockerfile).toMatch(new RegExp(`FROM base AS ${AI_WORKER_DOCKER_TARGET}\\b`));
    expect(dockerfile.indexOf("FROM base AS worker")).toBeLessThan(
      dockerfile.indexOf(`FROM base AS ${AI_WORKER_DOCKER_TARGET}`),
    );
    expect(dockerfile.indexOf(`FROM base AS ${AI_WORKER_DOCKER_TARGET}`)).toBeLessThan(
      dockerfile.indexOf("FROM base AS runner"),
    );
    expect(dockerfile).toMatch(/CMD \["node", "ai-worker\.cjs"\]/);
    expect(dockerfile).toMatch(/node_modules\/sharp/);
    expect(dockerfile.lastIndexOf("FROM base AS")).toBe(dockerfile.indexOf("FROM base AS runner"));
  });

  it("builds the bundle from a dedicated npm script that CI also runs", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["build:ai-worker"]).toMatch(/scripts\/ai-worker\.ts/);
    expect(pkg.scripts["build:ai-worker"]).toMatch(/--external:sharp/);
    expect(pkg.scripts["build:ai-worker"]).toContain(AI_WORKER_BUNDLE_RELATIVE.replace(/\\/g, "/"));
    expect(read(".github/workflows/ci.yml")).toMatch(/npm run build:ai-worker/);
  });

  it("deploys with its own logins, the scaler count, and no queued-mode switch", () => {
    const deploy = read("deploy/deploy-ai-worker.ps1");
    expect(deploy).toContain(AI_WORKER_SCALE_QUERY);
    expect(deploy).toContain(AI_WORKER_DB_SECRETS.user);
    expect(deploy).toContain(AI_WORKER_DB_SECRETS.password);
    expect(deploy).toContain(AI_SCALER_DB_SECRETS.user);
    expect(deploy).toContain(AI_SCALER_DB_SECRETS.password);
    expect(deploy).toContain(`userName=${AI_SCALER_DB_SECRETS.user}`);
    expect(deploy).toContain(`password=${AI_SCALER_DB_SECRETS.password}`);
    expect(deploy).not.toMatch(/DB_USER=secretref:runtime-db-user/);
    expect(deploy).not.toMatch(/DB_PASSWORD=secretref:runtime-db-password/);
    expect(deploy).not.toMatch(/AI_PHOTO_EXECUTION_MODE=/);
    for (const name of AI_WORKER_FORBIDDEN_API_DB_SECRETS) {
      expect(deploy).not.toMatch(new RegExp(`secretref:${name}\\b`));
    }
    for (const name of AI_WORKER_REQUIRED_CAP_ENV) {
      expect(deploy).toContain(name);
    }
    expect(deploy).toMatch(/Mandatory\s*=\s*\$true[\s\S]*Concurrency/);
    expect(deploy).toMatch(/--ingress[\s\S]*none|--target-port[\s\S]*0|no ingress|ingress.*none/i);
  });

  it("builds the bundle and exits before connecting when any cap is missing", () => {
    const build = spawnSync("npm", ["run", "build:ai-worker"], {
      cwd: root,
      encoding: "utf8",
      env: { ...spawnEnv(), npm_config_loglevel: "error" },
      timeout: 60_000,
      shell: process.platform === "win32",
    });
    expect(build.status, build.stderr || build.stdout).toBe(0);

    const run = spawnSync(process.execPath, [path.join(root, AI_WORKER_BUNDLE_RELATIVE)], {
      cwd: root,
      encoding: "utf8",
      env: spawnEnv(),
      timeout: 15_000,
    });
    expect(run.status).toBe(1);
    const line = (run.stdout || "")
      .split(/\r?\n/)
      .map((row) => row.trim())
      .find((row) => row.startsWith("{"));
    expect(line).toBeTruthy();
    const event = JSON.parse(line!) as { event?: string; missing?: string[] };
    expect(event.event).toBe("ai_worker.not_configured");
    expect(event.missing).toEqual([
      "AI_WORKER_ENABLED",
      ...AI_WORKER_REQUIRED_CAP_ENV,
    ]);
  }, 60_000);
});
