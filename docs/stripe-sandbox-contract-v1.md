# Stripe sandbox contract v1 (Phase 1)

This document records the backend payment handoff contract for QOS-43 while real Stripe sandbox account setup remains tracked in QOS-30.

## Provider

- Approved provider: Stripe Checkout (hosted)
- Permitted mode: sandbox test keys only (`sk_test_*`)
- Live keys (`sk_live_*`) are rejected at startup and request time

## Configuration (backend only)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Optional sandbox secret. When absent, labelled fixture handoffs are returned. |
| `STRIPE_API_VERSION` | Optional pinned API version (default `2024-11-20.acacia`). |
| `CHECKOUT_PAYMENT_RETURN_BASE_URL` | Base URL used to resolve client `returnPath` / `cancelPath`. |
| `CHECKOUT_PAYMENT_ALLOWED_RETURN_ORIGINS` | Comma-separated allowlist of permitted return origins. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret for callback verification. |
| `CHECKOUT_FIXTURE_WEBHOOK_SECRET` | Secret for labelled fixture reconciliation in development. |

No Stripe secrets are exposed to browser bundles or Quotes runtime.

## Handoff API

`POST /api/public/checkout/payment-attempts?contractVersion=1&storefrontPublicId=...&locationPublicId=...`

Body:

```json
{
  "operationId": "client-generated-idempotency-key",
  "quotePublicId": "qt_...",
  "expectedQuoteVersion": 1,
  "returnPath": "/checkout/return",
  "cancelPath": "/checkout/cancel"
}
```

Server rejects client-supplied `amountMinor`, `currency`, `liveMode`, and provider account identifiers.

## Idempotency

- `operationId` is scoped to tenant + verified customer
- Same payload hash replays the stored attempt response
- Conflicting reuse of the same `operationId` returns `409`
- Stripe session creation uses the same logical idempotency key: `{tenantId}:{operationId}`

## Fixture mode

When `STRIPE_SECRET_KEY` is not configured, responses are labelled fixture handoffs (`providerMode=fixture`, `handoff.isLabelledFixture=true`). These cannot satisfy real-provider acceptance in QOS-30.

## Webhook callback (QOS-44)

`POST /api/webhooks/stripe/checkout`

- Verifies `Stripe-Signature` against raw request body and `STRIPE_WEBHOOK_SECRET`
- Persists provider event intake before processing (`storefront_checkout_provider_events`)
- Supports `checkout.session.completed`, `checkout.session.expired`, and failure events
- Validates livemode=false, amount, currency, tenant and payment-attempt metadata
- Duplicate/out-of-order events cannot regress a terminal outcome

## Outcome status API (QOS-44)

`GET /api/public/checkout/payment-attempts/{paymentAttemptPublicId}?contractVersion=1&storefrontPublicId=...&locationPublicId=...`

- Requires verified customer session and attempt ownership
- Returns immutable quote line/total snapshot and truthful pending/succeeded/failed/cancelled/expired state
- Private, no-store cache headers

## Labelled fixture reconciliation

`POST /api/public/checkout/payment-fixtures/reconcile?storefrontPublicId=...&locationPublicId=...`

Header: `X-QOS-Fixture-Webhook-Secret: {CHECKOUT_FIXTURE_WEBHOOK_SECRET}`

Body: `{ "paymentAttemptPublicId": "pa_...", "outcome": "succeeded" | "failed" | "cancelled" }`

Only permitted for fixture-mode payment attempts. Cannot satisfy QOS-30 real-provider acceptance.

## Out of scope

- Customer-facing confirmation UI (QOS-39)
- Kitchen/POS/inventory/accounting side effects
