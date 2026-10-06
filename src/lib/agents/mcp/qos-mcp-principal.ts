export type QosMcpPrincipal = {
  tenantId: string;
  runPublicId: string;
  subject: string;
};

export type QosMcpPrincipalInput = {
  tenantId?: string;
  runPublicId?: string;
  subject?: string;
  sessionId?: string;
};

export function assertQosMcpPrincipal(input: QosMcpPrincipalInput): QosMcpPrincipal {
  const sessionId = input.sessionId?.trim();
  const subject = input.subject?.trim();
  if (sessionId && (!subject || subject === sessionId)) {
    throw new Error("MCP session IDs are not authentication.");
  }
  const tenantId = input.tenantId?.trim();
  const runPublicId = input.runPublicId?.trim();
  if (!tenantId || !runPublicId || !subject) {
    throw new Error("QOS MCP requires a host-authenticated principal.");
  }
  return { tenantId, runPublicId, subject };
}