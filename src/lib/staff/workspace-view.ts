import type { describeCheckoutPaymentConfig } from "@/lib/checkout/payment-config";

type StripeConfigSummary = ReturnType<typeof describeCheckoutPaymentConfig>;

export type StaffStripeIntegration = {
  id: "stripe";
  provider: "stripe";
  name: "Stripe";
  mode: StripeConfigSummary["mode"];
  currency: string;
  status: "connected" | "config_required";
  usesServerChosenCheckoutUrls: boolean;
};

export function staffStripeIntegrationView(
  summary: StripeConfigSummary,
): StaffStripeIntegration {
  return {
    id: "stripe",
    provider: summary.provider,
    name: "Stripe",
    mode: summary.mode,
    currency: summary.currency,
    status:
      summary.hasStripeSecretKey && summary.hasStripeWebhookSecret
        ? "connected"
        : "config_required",
    usesServerChosenCheckoutUrls: summary.usesServerChosenCheckoutUrls,
  };
}

export function formatMinorCurrency(amountMinor: number, currency: string) {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}
