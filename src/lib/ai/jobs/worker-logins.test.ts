import { describe, expect, it } from "vitest";

import {
  AI_SCALER_LOGIN,
  AI_WORKER_LOGIN,
  AiWorkerLoginError,
  provisionAiWorkerLogin,
  scramSha256Verifier,
} from "@/lib/ai/jobs/worker-logins";

describe("AI worker login specs", () => {
  it("gives each queue role its own login and a tight connection cap", () => {
    expect(AI_WORKER_LOGIN).toEqual({
      login: "qos_ai_worker_login",
      role: "qos_ai_worker",
      connectionLimit: 20,
    });
    expect(AI_SCALER_LOGIN).toEqual({
      login: "qos_ai_scaler_login",
      role: "qos_ai_scaler",
      connectionLimit: 5,
    });
    expect(AI_WORKER_LOGIN.login).not.toBe(AI_SCALER_LOGIN.login);
  });

  it("builds a SCRAM verifier Postgres will store without seeing the password", () => {
    const salt = Buffer.alloc(16, 7);
    const verifier = scramSha256Verifier("A".repeat(32), { salt, iterations: 4096 });
    expect(verifier.startsWith("SCRAM-SHA-256$4096:")).toBe(true);
    expect(verifier).toContain("$");
    expect(verifier).not.toContain("A".repeat(32));
  });

  it("refuses unsafe names or short passwords before touching the database", async () => {
    const sql = async () => {
      throw new Error("must not connect");
    };
    await expect(
      provisionAiWorkerLogin(sql as never, { ...AI_WORKER_LOGIN, login: "qos-ai" }, "A".repeat(32)),
    ).rejects.toBeInstanceOf(AiWorkerLoginError);
    await expect(
      provisionAiWorkerLogin(sql as never, AI_WORKER_LOGIN, "short"),
    ).rejects.toBeInstanceOf(AiWorkerLoginError);
  });
});
