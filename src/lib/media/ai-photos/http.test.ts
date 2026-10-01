import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";

import { AiPhotoError } from "@/lib/media/ai-photos/ai-photo-candidates";
import { aiPhotoErrorResponse } from "@/lib/media/ai-photos/http";

describe("aiPhotoErrorResponse", () => {
  it("keeps SQL text and parameters out of the response body", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new DrizzleQueryError(
      'select count(*)::int from "qos"."catalogue_media_assets" where "tenant_id" = $1',
      ["0fe2c09b-e07e-4c0c-a3e1-254773eed5b9", "ai_generated"],
      new Error('invalid input value for enum qos.data_provenance: "ai_generated"'),
    );

    const response = aiPhotoErrorResponse(error);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "AI photos are temporarily unavailable.", code: "ai_photos_storage_error" });
    expect(JSON.stringify(body)).not.toMatch(/select|0fe2c09b|catalogue_media_assets/);
    expect(consoleError).toHaveBeenCalledWith("AI photo request failed", error.cause);
    consoleError.mockRestore();
  });

  it("still returns domain errors with their message and status", async () => {
    const response = aiPhotoErrorResponse(new AiPhotoError("ai_photos_unavailable", "AI photos are not available.", 409));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "AI photos are not available.", code: "ai_photos_unavailable" });
  });
});
