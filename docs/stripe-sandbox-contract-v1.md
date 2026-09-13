# Stripe sandbox contract v1 (Phase 1)

This document records the backend payment handoff and reconciliation contract for QOS-43/QOS-44 with real Stripe sandbox acceptance tracked in QOS-30.

## Provider

- Approved provider: Stripe Checkout (hosted)
- Sandbox account identifier: **QOS-QUOTES-DEV**
- Permitted mode: sandbox test keys only (`sk_test_*`)
- Permitted currency: **AED**
- Live keys (`sk_live_*`) and live mode are rejected at configuration and request time

## Azure runtime (dev)

| Resource | Value |
| --- | --- |
| API Container App | `ca-qos-dev-api` |
| API URL | `https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io` |
| Storefront Container App | `ca-qos-dev-storefront` |
| Storefront URL | `https://ca-qos-dev-storefront.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io` |
| Runtime Key Vault | `kv-qos-dev-runtime` |

Secrets are stored in Key Vault and referenced by Container App env vars. **Never commit or log secret values.**

| Key Vault secret | Container App env var |
| --- | --- |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` |
| `stripe-webhook-secret` | `STRIPE_WEBHOOK_SECRET` |

Configured on `ca-qos-dev-api`:

| Variable | Value |
| --- | --- |
| `PAYMENTS_PROVIDER` | `stripe` |
| `PAYMENTS_MODE` | `sandbox` |
| `STRIPE_CURRENCY` | `AED` |
| `STRIPE_CHECKOUT_SUCCESS_URL` | Storefront `/checkout/success?session_id={CHECKOUT_SESSION_ID}` |
| `STRIPE_CHECKOUT_CANCEL_URL` | Storefront `/checkout/cancelled` |

When `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` are both set, QOS uses these server-chosen redirect URLs for Stripe Checkout. Client `returnPath` / `cancelPath` remain part of the handoff request for local development but are ignored for Stripe redirect resolution in deployed runtime.

## Configuration (backend only)

| Variable | Purpose |
| --- | --- |
| `PAYMENTS_PROVIDER` | Must be `stripe` in Phase 1. |
| `PAYMENTS_MODE` | Must be `sandbox`. Live/production values are rejected. |
| `STRIPE_CURRENCY` | Must be `AED`. |
| `STRIPE_SECRET_KEY` | Optional sandbox secret. When absent, labelled fixture handoffs are returned. |
| `STRIPE_WEBHOOK_SECRET` | Required when `STRIPE_SECRET_KEY` is configured. |
| `STRIPE_API_VERSION` | Optional pinned API version (default `2024-11-20.acacia`). |
| `STRIPE_CHECKOUT_SUCCESS_URL` | Server-chosen Stripe success redirect (must pair with cancel URL). |
| `STRIPE_CHECKOUT_CANCEL_URL` | Server-chosen Stripe cancel redirect. |
| `CHECKOUT_PAYMENT_RETURN_BASE_URL` | Base URL used to resolve client `returnPath` / `cancelPath` when server URLs are absent. |
| `CHECKOUT_PAYMENT_ALLOWED_RETURN_ORIGINS` | Comma-separated allowlist of permitted return origins. |
| `CHECKOUT_FIXTURE_WEBHOOK_SECRET` | Secret for labelled fixture reconciliation in development. |

No Stripe secrets are exposed to browser bundles or the Quotes runtime.

## Handoff API

`POST /api/public/checkout/payment-attempts?contractVersion=1&storefrontPublicId=...&locationPublicId=...`

Body:

```json
{
  "operationId": "client-generated-idempotency-key",
  "quotePublicId": "qt_...",
  "expectedQuoteVersion": 1,
  "returnPath": "/checkout/success",
  "cancelPath": "/checkout/cancelled"
}
```

Server rejects client-supplied `amountMinor`, `currency`, `liveMode`, and provider account identifiers.

## Idempotency

- `operationId` is scoped to tenant + verified customer
- Same payload hash (quote + version + resolved redirect URLs) replays the stored attempt response
- Conflicting reuse of the same `operationId` returns `409`
- Stripe session creation uses the same logical idempotency key: `{tenantId}:{operationId}`

## Fixture mode

When `STRIPE_SECRET_KEY` is not configured, responses are labelled fixture handoffs (`providerMode=fixture`, `handoff.isLabelledFixture=true`). These cannot satisfy real-provider acceptance in QOS-30.

## Webhook callback (QOS-44)

`POST /api/webhooks/stripe/checkout`

Active Stripe webhook destination (sandbox):

`https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io/api/webhooks/stripe/checkout`

Listening for:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`

Behaviour:

- Verifies `Stripe-Signature` against raw request body and `STRIPE_WEBHOOK_SECRET`
- Persists provider event intake before processing (`storefront_checkout_provider_events`)
- Validates livemode=false, amount, currency, tenant and payment-attempt metadata
- Duplicate/out-of-order events cannot regress a terminal outcome

**Deployment note:** Until the latest API image is deployed, this route may return `404`. After deployment, an unsigned POST must reach the handler and return `400 Invalid Stripe webhook signature` — not `404`.

## Outcome status APIs (QOS-44 / QOS-30)

By payment attempt public id:

`GET /api/public/checkout/payment-attempts/{paymentAttemptPublicId}?contractVersion=1&storefrontPublicId=...&locationPublicId=...`

By Stripe checkout session id (for storefront success redirect recovery):

`GET /api/public/checkout/provider-sessions/{providerReference}/outcome?contractVersion=1&storefrontPublicId=...&locationPublicId=...`

- Requires verified customer session and attempt ownership
- Returns immutable quote line/total snapshot and truthful pending/succeeded/failed/cancelled/expired state
- Performs bounded Stripe session lookup for pending/unknown sandbox attempts
- Private, no-store cache headers
- **Browser redirect parameters alone never mark success** — Quotes must call one of these APIs (QOS-39/QOS-60)

## Labelled fixture reconciliation

`POST /api/public/checkout/payment-fixtures/reconcile?storefrontPublicId=...&locationPublicId=...`

Header: `X-QOS-Fixture-Webhook-Secret: {CHECKOUT_FIXTURE_WEBHOOK_SECRET}`

Body: `{ "paymentAttemptPublicId": "pa_...", "outcome": "succeeded" | "failed" | "cancelled" }`

Only permitted for fixture-mode payment attempts. Cannot satisfy QOS-30 real-provider acceptance.

## Provider-backed verification (QOS-30)

Run locally or in CI-safe mode (no secrets required for config + webhook smoke):

```bash
npm run verify:stripe-sandbox
```

Checks:

1. Runtime config parses as stripe/sandbox/AED without exposing secret values
2. When `STRIPE_SECRET_KEY` is present locally, Stripe API connectivity confirms `livemode=false`
3. Unsigned POST to the configured webhook URL reaches signature validation (`400`) after deployment

Optional override: `STRIPE_WEBHOOK_VERIFY_URL` to target a different webhook endpoint.

## Out of scope

- Customer-facing confirmation UI (QOS-39 / QOS-60 in Quotes)
- Kitchen/POS/inventory/accounting side effects
