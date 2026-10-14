import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Opt-in real-provider smoke (owner authorization required). Skipped in CI by default.
 * Run manually: npm run agents:native-smoke -- --confirm ...
 */
describe.skip("openai provider smoke (manual only)", () => {
  it("documents the opt-in entrypoint and keeps CI workflows free of smoke env", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts/native-menu-manager-smoke.ts"), "utf8");
    expect(script).toContain("createMenuManagerNativeQosModel");
    const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(workflow).not.toContain("agents:native-smoke");
    expect(workflow).not.toContain("AGENT_NATIVE_SMOKE");
  });
});
