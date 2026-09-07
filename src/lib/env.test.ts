import { describe, expect, it } from "vitest";

import { readAppEnv } from "./env";

describe("readAppEnv", () => {
  it("defaults pool size and port when unset", () => {
    const env = readAppEnv({});

    expect(env.dbPort).toBe("5432");
    expect(env.dbPoolMax).toBe(10);
    expect(env.nodeEnv).toBe("development");
    expect(env.serviceVersion).toBe("0.1.0");
  });

  it("rejects a non-integer pool size", () => {
    expect(() => readAppEnv({ DB_POOL_MAX: "1.5" })).toThrow(
      "DB_POOL_MAX must be a positive integer.",
    );
  });
});
