import { describe, expect, it } from "vitest";

import { healthyPayload, livePayload, unhealthyPayload } from "./health";

describe("health payloads", () => {
  it("reports process liveness without a database field", () => {
    const payload = livePayload({ version: "0.1.0", startedAt: Date.now() });

    expect(payload.status).toBe("alive");
    expect(payload.service).toBe("qos-api");
    expect(payload.version).toBe("0.1.0");
    expect(payload.database).toBeUndefined();
  });

  it("does not include error details when the database is down", () => {
    const payload = unhealthyPayload({ version: "0.1.0", startedAt: Date.now() });

    expect(payload.status).toBe("unhealthy");
    expect(payload.database).toBe("disconnected");
    expect(payload).not.toHaveProperty("error");
  });

  it("marks a ready check as healthy when the database is connected", () => {
    const payload = healthyPayload({ version: "0.1.0", startedAt: Date.now() });

    expect(payload.status).toBe("healthy");
    expect(payload.database).toBe("connected");
  });
});
