import { describe, expect, it } from "vitest";

import { nativeModelErrorDiagnostics } from "@/lib/agents/native/native-model-error";

describe("nativeModelErrorDiagnostics", () => {
  it("captures safe OpenAI-style fields and never includes message bodies", () => {
    const diagnostics = nativeModelErrorDiagnostics(
      {
        name: "Error",
        status: 429,
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        message: "secret prompt echoed here",
      },
      "gpt-test",
    );
    expect(diagnostics).toEqual({
      modelId: "gpt-test",
      httpStatus: 429,
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
      errorName: "Error",
    });
    expect(diagnostics).not.toHaveProperty("message");
  });
});
