import { describe, expect, it } from "vitest";

import { assertQosMcpPrincipal } from "@/lib/agents/mcp/qos-mcp-principal";

describe("QOS MCP principal", () => {
  it("accepts a host-authenticated tenant run subject", () => {
    expect(
      assertQosMcpPrincipal({
        tenantId: "ten_1",
        runPublicId: "run_1",
        subject: "admin@test",
      }),
    ).toEqual({ tenantId: "ten_1", runPublicId: "run_1", subject: "admin@test" });
  });

  it("rejects a missing host principal", () => {
    expect(() => assertQosMcpPrincipal({})).toThrow("host-authenticated principal");
    expect(() =>
      assertQosMcpPrincipal({ tenantId: "ten_1", runPublicId: "run_1", subject: "  " }),
    ).toThrow("host-authenticated principal");
  });

  it("rejects an MCP session id as authentication", () => {
    expect(() => assertQosMcpPrincipal({ sessionId: "sess_abc" })).toThrow("session IDs are not authentication");
    expect(() =>
      assertQosMcpPrincipal({
        tenantId: "ten_1",
        runPublicId: "run_1",
        subject: "sess_abc",
        sessionId: "sess_abc",
      }),
    ).toThrow("session IDs are not authentication");
  });
});