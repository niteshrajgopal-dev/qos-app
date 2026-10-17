import { describe, expect, it } from "vitest";

import {
  AI_PHOTO_CUSTOMER_DISCLOSURE_I18N_KEY,
  AI_PHOTO_CUSTOMER_DISCLOSURE_PLACEHOLDER,
} from "@/lib/media/ai-photos/customer-disclosure";

describe("AI photo customer disclosure placeholders", () => {
  it("uses one i18n key and marked placeholder copy in EN and AR", () => {
    expect(AI_PHOTO_CUSTOMER_DISCLOSURE_I18N_KEY).toBe("catalogue.media.ai_photo_customer_disclosure");
    for (const value of Object.values(AI_PHOTO_CUSTOMER_DISCLOSURE_PLACEHOLDER)) {
      expect(value).toContain("[PLACEHOLDER — pending owner approval]");
    }
  });
});
