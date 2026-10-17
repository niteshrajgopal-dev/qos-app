import { describe, expect, it } from "vitest";

import { classifyMenuExtractionVisionError } from "@/lib/agents/native/menu-extraction-vision-classify";

describe("menu extraction vision error classification", () => {
  it("maps OpenAI 400 json_schema errors to schema_rejected", () => {
    const OpenAI = loadOpenAi();
    const error = OpenAI.APIError.generate(
      400,
      {
        error: {
          message: "Invalid schema for response_format: unknown keyword",
          type: "invalid_request_error",
          param: "response_format",
          code: "invalid_json_schema",
        },
      },
      "400 invalid schema",
      new Headers(),
    );
    const classified = classifyMenuExtractionVisionError(error);
    expect(classified.code).toBe("schema_rejected");
    expect(classified.diagnostics.httpStatus).toBe(400);
    expect(classified.diagnostics.providerCode).toBe("invalid_json_schema");
  });

  it("maps model_not_found to model_not_supported", () => {
    const OpenAI = loadOpenAi();
    const error = OpenAI.APIError.generate(
      404,
      {
        error: {
          message: "The model `fake-vision` does not exist",
          type: "invalid_request_error",
          code: "model_not_found",
        },
      },
      "404",
      new Headers(),
    );
    expect(classifyMenuExtractionVisionError(error).code).toBe("model_not_supported");
  });

  it("maps connection errors to provider_unavailable", () => {
    const OpenAI = loadOpenAi();
    const error = new OpenAI.APIConnectionError({ message: "Connection error." });
    expect(classifyMenuExtractionVisionError(error).code).toBe("provider_unavailable");
  });

  it("maps timeouts to provider_timeout", () => {
    const OpenAI = loadOpenAi();
    const error = new OpenAI.APIConnectionTimeoutError();
    expect(classifyMenuExtractionVisionError(error).code).toBe("provider_timeout");
  });
});

function loadOpenAi() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("openai") as typeof import("openai");
}
