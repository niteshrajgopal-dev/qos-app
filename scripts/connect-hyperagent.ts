import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createDbClient } from "@/db/client";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { parseHyperagentToolResult } from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import { QosOAuthClientProvider } from "@/lib/agents/hyperagent/hyperagent-oauth";
import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";
import { saveAgentProviderConnection } from "@/lib/agents/provider-connections";

import { assertConfirmedDatabaseHost, readOperatorArgs, requireArg } from "./agent-operator-cli";

const CALLBACK_PORT = 33418;
const CALLBACK_PATH = "/oauth/callback";
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

function usage() {
  return [
    "Connects the platform Hyperagent account (operator only).",
    "",
    "  npm run agents:connect-hyperagent -- --operator <you@company> --database-host <host>",
    "      [--account-label <label>] [--expect-agent <agentId>]",
    "",
    "Requires DATABASE_URL, HYPERAGENT_MCP_URL and AGENT_CREDENTIAL_ENCRYPTION_KEY in the environment.",
  ].join("\n");
}

function openBrowser(url: string) {
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

function waitForAuthorizationCode(expectedState: string) {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }

      const finish = (status: number, message: string, outcome: () => void) => {
        response.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(message);
        clearTimeout(timer);
        server.close();
        outcome();
      };

      if (url.searchParams.get("state") !== expectedState) {
        finish(400, "State mismatch. Close this tab and rerun the command.", () =>
          reject(new Error("OAuth state mismatch.")),
        );
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        finish(400, "Authorization was not granted. You can close this tab.", () =>
          reject(new Error(`Authorization failed: ${error ?? "no code returned"}`)),
        );
        return;
      }
      finish(200, "QOS is now connected to Hyperagent. You can close this tab.", () =>
        resolve(code),
      );
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the OAuth callback."));
    }, CALLBACK_TIMEOUT_MS);

    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

async function main() {
  const args = readOperatorArgs({
    operator: { type: "string" },
    "database-host": { type: "string" },
    "account-label": { type: "string" },
    "expect-agent": { type: "string" },
    help: { type: "boolean" },
  });
  if (args.help) {
    console.log(usage());
    return;
  }

  const operator = requireArg(args, "operator");
  const databaseHost = assertConfirmedDatabaseHost(requireArg(args, "database-host"));
  const config = readAgentConfig();
  if (!config.hyperagentMcpUrl) {
    throw new Error("HYPERAGENT_MCP_URL must be set.");
  }
  const credentialKey = parseAgentCredentialKey(config.credentialEncryptionKey);
  const serverUrl = new URL(config.hyperagentMcpUrl);

  const oauthState = randomBytes(24).toString("base64url");
  const authProvider = new QosOAuthClientProvider({
    redirectUrl: `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`,
    oauthState,
    onAuthorizationUrl: (authorizationUrl) => {
      console.log(`\nOpen this URL to authorize QOS:\n\n  ${authorizationUrl.toString()}\n`);
      openBrowser(authorizationUrl.toString());
    },
  });

  const codePromise = waitForAuthorizationCode(oauthState);
  const firstTransport = new StreamableHTTPClientTransport(serverUrl, { authProvider });
  const firstClient = new Client({ name: "qos-platform", version: "1.0.0" });
  try {
    await firstClient.connect(firstTransport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
  }

  if (!authProvider.tokens()) {
    const code = await codePromise;
    await firstTransport.finishAuth(code);
  }
  await firstClient.close().catch(() => undefined);

  const verifyClient = new Client({ name: "qos-platform", version: "1.0.0" });
  await verifyClient.connect(new StreamableHTTPClientTransport(serverUrl, { authProvider }));
  const provider = new HyperagentProvider(async (name, toolArgs) =>
    parseHyperagentToolResult(name, (await verifyClient.callTool({ name, arguments: toolArgs })) as never),
  );
  const agents = await provider.listAgents();
  await verifyClient.close().catch(() => undefined);

  console.log("Agents visible to this connection:");
  for (const agent of agents) {
    console.log(`  ${agent.providerAgentId}  ${agent.name}`);
  }

  const expectedAgent = typeof args["expect-agent"] === "string" ? args["expect-agent"] : null;
  if (expectedAgent && !agents.some((agent) => agent.providerAgentId === expectedAgent)) {
    throw new Error(`Agent ${expectedAgent} is not visible to this account; nothing was saved.`);
  }

  const { db, sql } = createDbClient();
  try {
    await saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: config.hyperagentMcpUrl,
      accountLabel: typeof args["account-label"] === "string" ? args["account-label"] : null,
      connectedBySubject: operator,
      credentials: authProvider.snapshot(),
      credentialKey,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(`\nSaved the platform Hyperagent connection to ${databaseHost}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\n${usage()}`);
  // The loopback listener may still be open after an early failure.
  process.exit(1);
});
