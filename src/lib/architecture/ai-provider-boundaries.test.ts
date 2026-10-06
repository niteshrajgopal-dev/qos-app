import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Provider SDKs, provider endpoints and provider credentials stay inside the
 * designated adapters. Routes, UI, catalogue services and domain contracts
 * must reach AI only through QOS-owned interfaces. Changing an allowlist here
 * is an architecture decision and needs review.
 */

type SourceFile = { path: string; source: string };

const SCANNED_ROOTS = ["src", "scripts"];
const SCANNED_EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const THIS_FILE = "src/lib/architecture/ai-provider-boundaries.test.ts";

const SDK_RULES: Array<{ name: string; matches: (specifier: string) => boolean; allowed: string[] }> = [
  {
    name: "MCP SDK",
    matches: (s) => s === "@modelcontextprotocol/sdk" || s.startsWith("@modelcontextprotocol/sdk/"),
    allowed: ["src/lib/agents/hyperagent/", "src/lib/agents/mcp/", "scripts/connect-hyperagent.ts"],
  },
  {
    name: "model provider SDK",
    matches: (s) =>
      s === "openai" ||
      s.startsWith("openai/") ||
      s.startsWith("@openai/") ||
      s.startsWith("@anthropic-ai/") ||
      s === "@google/genai" ||
      s === "@google/generative-ai" ||
      s.startsWith("@ai-sdk/") ||
      s === "ai",
    allowed: ["src/lib/agents/native/"],
  },
];

const ENDPOINT_RULES: Array<{ pattern: RegExp; allowed: string[] }> = [
  { pattern: /api\.openai\.com/, allowed: ["src/lib/media/ai-photos/openai-photo-provider.ts"] },
  { pattern: /hyperagent\.com/, allowed: ["src/lib/agents/hyperagent/"] },
  { pattern: /api\.anthropic\.com/, allowed: [] },
  { pattern: /generativelanguage\.googleapis\.com/, allowed: [] },
];

const CREDENTIAL_RULES: Array<{ pattern: RegExp; allowed: string[] }> = [
  {
    pattern: /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)\b/,
    allowed: ["src/lib/media/ai-photos/config.ts", "src/lib/agents/native/native-model-config.ts"],
  },
];

/** Adapter modules and the only places allowed to import them. */
const ADAPTER_RULES: Array<{ name: string; target: (resolved: string) => boolean; allowed: string[] }> = [
  {
    name: "Hyperagent adapter",
    target: (r) => r.startsWith("src/lib/agents/hyperagent/"),
    allowed: [
      "src/lib/agents/hyperagent/",
      "src/lib/agents/provider-registry.ts",
      "src/lib/agents/testing/",
      "scripts/",
    ],
  },
  {
    name: "OpenAI image adapter",
    target: (r) => r === "src/lib/media/ai-photos/openai-photo-provider",
    allowed: ["src/lib/media/ai-photos/provider.ts"],
  },
  {
    name: "native Agents SDK adapter",
    target: (r) => r === "src/lib/agents/native/agents-sdk-model",
    allowed: ["src/lib/agents/native/", "scripts/ai-worker.ts", "scripts/native-menu-manager-smoke.ts"],
  },
  {
    name: "QOS MCP adapter",
    target: (r) => r.startsWith("src/lib/agents/mcp/"),
    allowed: ["src/lib/agents/mcp/"],
  },
];

/** Routes and UI never construct or select providers. */
const APP_FORBIDDEN_TARGETS = [
  "src/lib/agents/provider-registry",
  "src/lib/media/ai-photos/provider",
  "src/lib/media/ai-photos/openai-photo-provider",
];

function isTestFile(file: string) {
  return /\.(test|spec)\.[cm]?[tj]sx?$/.test(file);
}

function isAllowed(file: string, allowed: string[]) {
  return allowed.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

function moduleSpecifiers(source: string) {
  const specifiers: string[] = [];
  const pattern =
    /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"'\n]+)["']/gm;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function resolveSpecifier(fromFile: string, specifier: string) {
  let resolved: string | null = null;
  if (specifier.startsWith("@/")) {
    resolved = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith(".")) {
    resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  }
  return resolved?.replace(/\.(ts|tsx|js|mjs)$/, "") ?? null;
}

function findBoundaryViolations(files: SourceFile[]) {
  const violations: string[] = [];

  for (const { path: file, source } of files) {
    const test = isTestFile(file);

    for (const specifier of moduleSpecifiers(source)) {
      for (const rule of SDK_RULES) {
        if (rule.matches(specifier) && !isAllowed(file, rule.allowed)) {
          violations.push(`${file}: imports ${rule.name} "${specifier}" outside its adapter`);
        }
      }

      const resolved = resolveSpecifier(file, specifier);
      if (!resolved) {
        continue;
      }
      for (const rule of ADAPTER_RULES) {
        if (rule.target(resolved) && !test && !isAllowed(file, rule.allowed)) {
          violations.push(`${file}: imports the ${rule.name} (${specifier}) directly`);
        }
      }
      if (file.startsWith("src/app/") && APP_FORBIDDEN_TARGETS.includes(resolved)) {
        violations.push(`${file}: routes and UI must not import provider selection (${specifier})`);
      }
    }

    if (test) {
      continue;
    }
    for (const rule of ENDPOINT_RULES) {
      if (rule.pattern.test(source) && !isAllowed(file, rule.allowed)) {
        violations.push(`${file}: contains provider endpoint ${rule.pattern.source} outside its adapter`);
      }
    }
    for (const rule of CREDENTIAL_RULES) {
      if (rule.pattern.test(source) && !isAllowed(file, rule.allowed)) {
        violations.push(`${file}: reads a provider credential outside its config module`);
      }
    }
  }

  return violations;
}

function collect(root: string, dir: string, out: SourceFile[]) {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        collect(root, relative, out);
      }
    } else if (SCANNED_EXTENSIONS.test(entry.name) && relative !== THIS_FILE) {
      out.push({ path: relative, source: readFileSync(path.join(root, relative), "utf8") });
    }
  }
  return out;
}

describe("AI provider boundaries", () => {
  const root = process.cwd();
  const files = SCANNED_ROOTS.flatMap((dir) => collect(root, dir, []));

  it("scans the repository", () => {
    expect(files.some((file) => file.path === "src/lib/agents/hyperagent/hyperagent-mcp-client.ts")).toBe(true);
    expect(files.some((file) => file.path === "src/lib/media/ai-photos/openai-photo-provider.ts")).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it("keeps provider SDKs, endpoints, credentials and adapters behind their boundaries", () => {
    expect(findBoundaryViolations(files)).toEqual([]);
  });

  it("keeps domain contracts free of SDK and adapter imports", () => {
    const contracts = [
      "src/lib/agents/types.ts",
      "src/lib/agents/execution-identity.ts",
      "src/lib/agents/executor-readiness.ts",
      "src/lib/ai/provider-outcome.ts",
      "src/lib/ai/execution-identity.ts",
      "src/lib/media/ai-photos/provider-contract.ts",
    ];
    for (const contract of contracts) {
      const file = files.find((candidate) => candidate.path === contract);
      expect(file, contract).toBeDefined();
      const imports = moduleSpecifiers(file!.source);
      expect(
        imports.filter(
          (s) => !s.startsWith("@/") && !s.startsWith(".") && !s.startsWith("node:") && s !== "zod",
        ),
        contract,
      ).toEqual([]);
      expect(imports.filter((s) => s.includes("/hyperagent/") || s.includes("openai-photo-provider")), contract).toEqual(
        [],
      );
    }
  });

  describe("detects synthetic violations", () => {
    const cases: Array<[string, SourceFile]> = [
      ["SDK import in catalogue", { path: "src/lib/catalogue/x.ts", source: 'import OpenAI from "openai";' }],
      ["scoped SDK import in a route", { path: "src/app/api/x/route.ts", source: 'import { Agent } from "@openai/agents";' }],
      ["dynamic SDK import", { path: "src/lib/x.ts", source: 'const m = await import("@anthropic-ai/sdk");' }],
      ["MCP SDK outside Hyperagent", { path: "src/lib/catalogue/x.ts", source: 'import { Client } from "@modelcontextprotocol/sdk/client/index.js";' }],
      ["raw provider URL in a service", { path: "src/lib/catalogue/x.ts", source: 'await fetch("https://api.openai.com/v1/responses");' }],
      ["provider credential outside config", { path: "src/lib/menu/x.ts", source: "const key = process.env.OPENAI_API_KEY;" }],
      ["adapter import from a service", { path: "src/lib/catalogue/x.ts", source: 'import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";' }],
      ["relative adapter import", { path: "src/lib/agents/menu-manager/x.ts", source: 'import { x } from "../hyperagent/hyperagent-runtime";' }],
      ["OpenAI adapter outside its registry", { path: "src/lib/media/ai-photos/ai-photo-candidates.ts", source: 'import { createOpenAiPhotoProvider } from "@/lib/media/ai-photos/openai-photo-provider";' }],
      ["provider selection from a route", { path: "src/app/api/x/route.ts", source: 'import { getAgentRuntimeProvider } from "@/lib/agents/provider-registry";' }],
    ];

    it.each(cases)("%s", (_label, file) => {
      expect(findBoundaryViolations([file])).toHaveLength(1);
    });

    it("allows the designated adapters and registries", () => {
      expect(
        findBoundaryViolations([
          { path: "src/lib/agents/hyperagent/x.ts", source: 'import { Client } from "@modelcontextprotocol/sdk/client/index.js";' },
          { path: "src/lib/agents/mcp/qos-mcp-adapter.ts", source: 'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";' },
          { path: "src/lib/media/ai-photos/openai-photo-provider.ts", source: 'const URL = "https://api.openai.com/v1/images/generations";' },
          { path: "src/lib/media/ai-photos/config.ts", source: "source.OPENAI_API_KEY" },
          { path: "src/lib/agents/provider-registry.ts", source: 'import { x } from "@/lib/agents/hyperagent/hyperagent-runtime";' },
          { path: "src/lib/media/ai-photos/provider.ts", source: 'import { x } from "@/lib/media/ai-photos/openai-photo-provider";' },
          { path: "src/lib/agents/native/agents-sdk-model.ts", source: 'import { Agent } from "@openai/agents";' },
          { path: "src/lib/agents/native/native-model-config.ts", source: "source.OPENAI_API_KEY" },
          { path: "src/app/api/x/route.ts", source: 'import type { AgentRunView } from "@/lib/agents/agent-runs";' },
        ]),
      ).toEqual([]);
    });
  });
});
