import { describe, expect, it } from "vitest";

import {
  describeCheckoutPaymentConfig,
  readCheckoutPaymentConfig,
} from "@/lib/checkout/payment-config";
import {
  formatMinorCurrency,
  staffStripeIntegrationView,
} from "@/lib/staff/workspace";

describe("staff workspace views", () => {
  it("never exposes Stripe secrets and marks sandbox ready only when keys exist", () => {
    const disconnected = staffStripeIntegrationView(
      describeCheckoutPaymentConfig(readCheckoutPaymentConfig({})),
    );
    expect(disconnected.status).toBe("config_required");
    expect(JSON.stringify(disconnected)).not.toMatch(/sk_|whsec_/);

    const connected = staffStripeIntegrationView(
      describeCheckoutPaymentConfig(
        readCheckoutPaymentConfig({
          STRIPE_SECRET_KEY: "sk_test_example",
          STRIPE_WEBHOOK_SECRET: "whsec_example",
        }),
      ),
    );
    expect(connected.status).toBe("connected");
    expect(connected.provider).toBe("stripe");
    expect(connected.mode).toBe("sandbox");
    expect(connected.currency).toBe("AED");
  });

  it("formats AED minor units without inventing a second currency", () => {
    expect(formatMinorCurrency(1250, "AED")).toBe("12.50 AED");
  });
});
