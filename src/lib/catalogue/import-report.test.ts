import { describe, expect, it } from "vitest";

import {
  classifyCatalogueImportError,
  normalizeImportErrorReason,
  summarizeCatalogueImportErrors,
} from "@/lib/catalogue/import-report";

describe("catalogue import report grouping", () => {
  it("classifies FineDine HTTP 413 failures", () => {
    expect(
      classifyCatalogueImportError(
        'FineDine image is too large to return (HTTP 413 TooLargeImageException) for source 6a6f91adb40112c97850ae76.',
      ),
    ).toBe("finedine-http-413");
  });

  it("classifies Azure key-auth failures without treating request IDs as unique categories", () => {
    const left = classifyCatalogueImportError(
      "Key based authentication is not permitted on this storage account.\nRequestId:11111111-2222-3333-4444-555555555555\nTime:2026-09-19T16:01:02.1234567Z",
    );
    const right = classifyCatalogueImportError(
      "Key based authentication is not permitted on this storage account.\nRequestId:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\nTime:2026-09-19T16:09:08.7654321Z",
    );

    expect(left).toBe("azure-auth");
    expect(right).toBe("azure-auth");
    expect(
      normalizeImportErrorReason(
        "Key based authentication is not permitted on this storage account. RequestId:11111111-2222-3333-4444-555555555555 Time:2026-09-19T16:01:02.1234567Z",
      ),
    ).not.toMatch(/11111111-2222-3333-4444-555555555555/);
  });

  it("classifies pixel-limit failures and groups remaining errors as other", () => {
    expect(
      classifyCatalogueImportError(
        "Uploaded image exceeds the configured pixel limits",
      ),
    ).toBe("pixel-limit");
    expect(classifyCatalogueImportError("Unexpected timeout")).toBe("other");
  });

  it("summarizes error rows into stable categories", () => {
    expect(
      summarizeCatalogueImportErrors([
        {
          reason:
            "Remote image fetch failed with HTTP 413. TooLargeImageException",
        },
        {
          reason:
            "Key based authentication is not permitted on this storage account. RequestId:abc Time:2026-01-01T00:00:00Z",
        },
        { reason: "Uploaded image exceeds the configured pixel limits." },
        { reason: "disk full" },
      ]),
    ).toEqual({
      "finedine-http-413": 1,
      "azure-auth": 1,
      "pixel-limit": 1,
      other: 1,
    });
  });
});
