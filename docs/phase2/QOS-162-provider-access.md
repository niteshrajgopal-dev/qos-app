# QOS-162 Provider Access Discovery: Loyverse and Foodics

| Item | Value |
| --- | --- |
| Discovery date | 21 November 2026, 14:27 Asia/Dubai (UTC+4) |
| Repository | `niteshrajgopal-dev/qos-app`, clone `/workspace/qos-phase2/work-qos162` |
| Repo HEAD | `99d8106f386bcd349f8f51b263481bb90227d0fc` (Merge pull request #87, `cursor/qa-restyle-followups-f510`), working tree clean |
| Linear snapshot | `/workspace/qos-phase2/linear-live/QOS-162-QOS-185-live.md`, retrieved 21 November 2026, 14:20 Asia/Dubai |
| Pack | `QOS_Phase2_Grok_Implementation_Pack`, dated 21 November 2026 |
| Author | Fable (discovery agent), for QOS-162 |

**Status.** Access has not been obtained. This document is discovery only. No sandbox or production credentials for Loyverse or Foodics exist in this repository, in `.env.example`, in the Linear issues QOS-162 or QOS-185, or anywhere the discovery could inspect. No provider was contacted, no account was created, no live API call was made, and no feature code was written. Provider choice remains open. Every claim below carries one of three grades: **verified** (source fetched or inspected this run), **documented-only** (stated in official docs, the pack or Linear, but not exercised), or **unknown** (not established from evidence).

## 1. Executive Summary

- **Neither in-scope provider is accessible today.** The repository contains zero Loyverse or Foodics code, schema, configuration keys or fixtures (verified: repo-wide grep for `loyverse|foodics` outside `node_modules` returned no files). Linear holds no access-grant, credential, sandbox or partner-application issue (verified from the snapshot).
- **Loyverse is the lower-friction path on paper.** Its API docs are public, the account owner can self-issue a personal access token in Back Office, OAuth app registration is self-service behind a Loyverse login, receipts carry line items, line modifiers, payments, discounts, taxes and refund linkage, and webhooks plus cursor pagination are documented (verified from the OpenAPI spec). Loyverse publishes no sandbox environment (unknown whether one exists). The only blocker is that Quotes must own a Loyverse account and authorise QOS, and nobody has confirmed that Quotes has one.
- **Foodics requires a provider-side action before anything can start.** Developer applications and sandbox accounts are created by the Foodics team after the developer emails requirements to `support@foodics.com` (verified from the official Get Started guide). Token access is OAuth 2.0 authorisation code only; no self-issued merchant token is documented in v5. Read scopes for sales (`orders.list`, `general.read`) are granted by Foodics according to the declared integration category. Lead time and cost are not published (unknown).
- **The client's branch report is unverified.** "Loyverse for Al Ain, Foodics for Azur" appears only as a client statement in the pack and Linear. Nothing in the repo, pack or Linear confirms account ownership, branch IDs or whether the Dubai label has any POS at all.
- **Existing repo integrations are not inbound POS evidence.** The Integrations and POS screens are a prototype port over mock data behind a "Sample data" banner. The only real connection state is Stripe sandbox configuration. FineDine is a public-menu catalogue import. Lightspeed, Talabat and Deliveroo exist only as mock rows.
- **Menu, workbook, recipe and inventory work is not blocked by any of this.** Provider access gates QOS-178, QOS-179, QOS-211, QOS-181 and QOS-185 only.

### Per-Provider Table

| Provider | In-scope? | Access status | Evidence grade | What the repo has | Blocker | Owner | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Loyverse | Yes (candidate) | None. No account, token or OAuth app known to QOS. Public API docs read; no live call. | Docs verified; access unknown | Nothing. No code, schema, env key, fixture or SDK. Prototype `P2Pos.tsx` shows a simulated "Loyverse" connection only. | Quotes must confirm it owns a Loyverse account covering the Al Ain branch and must decide whether the owner issues a personal access token (read-only not possible; token is all-access) or whether QOS registers an OAuth app and the owner grants `RECEIPTS_READ`, `STORES_READ`, `ITEMS_READ`, `PAYMENT_TYPES_READ`, `TAXES_READ`, `MERCHANT_READ`. | Nitesh with Quotes owner | Nitesh decides the auth path and confirms account ownership; credentials go to Key Vault, not files. |
| Foodics | Yes (candidate) | None. No developer app, sandbox or token known to QOS. Public API docs read; no live call. | Docs verified; access unknown | Nothing. No code, schema, env key, fixture or SDK. Prototype shows a simulated "Foodics" connection only. | Developer app and sandbox are created by Foodics after an email to `support@foodics.com` with integration scope and redirect URL. Quotes must separately confirm it owns a Foodics business covering Azur and the owner must authorise the app via the console. Scope grant (`orders.list` + `general.read`) depends on the declared category. | Nitesh (request), Quotes owner (authorise) | Nitesh decides whether to send the developer-app request to Foodics. Nobody else may send it. |
| FineDine | No (adjacent, menu import) | Repo reads a public QR menu URL; fixture by default. No credentials involved. | Verified in repo | `location_external_menu_sources` table (provider enum `finedine`), import scripts, fixtures, `connection_key` convention `finedine.hbz-stadium`. | Not a sales source. Must not be presented as POS proof. | n/a | None for QOS-162. Reuse the `connection_key` and import-operation patterns as design precedent only. |
| Stripe | No (adjacent, payments) | Sandbox-only runtime; connection state derived from env secrets. | Verified in repo | Checkout provider, webhook route, `staffStripeIntegrationView` real connected/config_required state, `docs/stripe-sandbox-contract-v1.md`, Key Vault secret pattern. | Not a POS. Payment tenders in Phase 2 come from the POS, not Stripe. | n/a | None for QOS-162. Reuse the Key Vault secret pattern for provider credentials. |
| Lightspeed, Talabat, Deliveroo | No (mock only) | Mock rows in `src/mocks/platform.ts`. | Verified in repo | Prototype Integration Centre screen with hard-coded "Lightspeed POS is returning errors" alert and fake `POST /v3/orders` log. | Not real. Not Phase 2 inbound scope. | n/a | Do not treat as evidence. |

## 2. Linear and Pack Baseline

- QOS-162 is **Todo**, unassigned, no comments, labels Phase 2 and Needs decision, blocks QOS-178 (verified from snapshot).
- QOS-185 is **Backlog**, blocked by QOS-181, QOS-182, QOS-183, QOS-184; requires real provider evidence and explicitly rejects login, fixtures, screenshots and prototype simulation (verified from snapshot).
- A Linear search for "Loyverse" and "Foodics" returned only Phase 2 planning issues. No access-grant, credential, sandbox or partner-application issue exists (verified from snapshot).
- The pack's Start_Here asks Nitesh to "prepare one authorised Loyverse or Foodics account/environment/branch and an agreed source period with representative sales" and states that no provider test was performed in preparing the pack (verified from `Start_Here.md`).
- Requirements in scope: P2-POS-01 to P2-POS-07, AC24, AC42; the inbound contract requires per-capability Supported / Unsupported / Unverified marking and forbids inferring entitlement from login (verified from `linear/03_Inbound_POS_Contract.md`).

## 3. Loyverse

### 3.1 Documentation and Access Model

| Topic | Finding | Grade |
| --- | --- | --- |
| Reference docs | `https://developer.loyverse.com/docs/` renders a Redoc page from the OpenAPI file `https://developer.loyverse.com/docs/API-Reference__v1.0.yaml` (142,914 bytes, downloaded this run). The HTML shell itself only shows a sign-in link; the YAML is the substantive source. | verified |
| API version and base URL | `https://api.loyverse.com/v1.0`; version is part of the path. | verified |
| Auth option A: personal access token | Created in Back Office under Access Tokens (`https://r.loyverse.com/dashboard/#/integrations/tokens`). Up to 20 tokens per account, optional expiry, deletable. The docs state the token "gives unlimited access to the targeted account". Sent as `Authorization: Bearer <token>`. | verified (spec and `https://help.loyverse.com/help/loyverse-api`) |
| Auth option B: OAuth 2.0 authorisation code | Create an app at the developer dashboard (`developer.loyverse.com/apps`, behind Loyverse sign-in) to receive `client_id` and `client_secret`. Authorise at `https://api.loyverse.com/oauth/authorize` with `scope`, `redirect_uri`, `state`; exchange at `https://api.loyverse.com/oauth/token`; the example response shows `expires_in: 43200` (12 hours) and a `refresh_token`. Refresh via `grant_type=refresh_token`. OpenID Connect is available with the `openid` scope. | verified |
| Scopes relevant to inbound sales | `receipts_read`, `stores_read`, `items_read`, `payment_types_read`, `taxes_read`, `merchant_read`, `pos_devices_read`, `employees_read`, `shifts_read`. Write scopes exist but are not needed. | verified |
| Who can authorise | Help centre describes the merchant connecting marketplace apps from Back Office "Apps" and clicking "Allow"; revocation is "Disconnect app". It does not state which roles may do this. | documented-only / role unknown |
| Developer registration | "Register as developer" on `https://loyverse.com/loyverse-pos-api` links to a Loyverse login that returns to `developer.loyverse.com/apps`. No fee, review or approval step is described anywhere fetched. | documented-only; approval process unknown |
| Sandbox environment | No sandbox host, test mode or demo account is documented in the spec, help centre or API page. The spec suggests Postman against a real account. | unknown (none found) |
| Cost | Loyverse pricing page: "Loyverse is free to use, with optional paid add-ons"; Integrations are listed under free features. Paid add-ons: Unlimited sales history USD 7/store/month, Employee management USD 25/store/month, Advanced inventory USD 25/store/month, each with a 14-day trial. The pricing page does not say whether API receipt history is limited without Unlimited sales history. The spec lists error `402 PAYMENT_REQUIRED: The subscription of account has lapsed`. | verified (pricing text); API history limit unknown |
| Lead time | Not published. Token issuance is self-service once the owner is logged in. OAuth app creation is self-service. | unknown (no documented wait) |

### 3.2 Read APIs for Sales

All items in this table are **verified** from the OpenAPI file unless marked otherwise.

| Capability | Endpoint and fields |
| --- | --- |
| Receipt list | `GET /receipts`, sorted by `created_at` descending. Filters: `receipt_numbers`, `since_receipt_number`, `before_receipt_number`, `store_id`, `order`, `source`, `updated_at_min`, `updated_at_max`, `created_at_min`, `created_at_max`, `limit` (default 50, max 250), `cursor`. |
| Single receipt | `GET /receipts/{receipt_number}`. |
| Receipt identity | `receipt_number` ("The internal identifier for the receipt. It is unique."), `store_id`, `pos_device_id`, `employee_id`, `customer_id`, `source`, `created_at`, `receipt_date`, `updated_at`, `cancelled_at`. |
| Receipt type and refunds | `receipt_type` enum `SALE` or `REFUND`; `refund_for` links a refund receipt to the original receipt number. `total_money` is "the total money amount paid by customer (or returned to customer in case of refund)". |
| Financial totals | `total_money`, `total_tax`, `total_discount`, `total_discounts[]` (id, type, name, percentage, money_amount), `total_taxes[]` (id, type `INCLUDED` or `ADDED`, name, rate, money_amount), `tip`, `surcharge`, `dining_option`. |
| Lines | `line_items[]`: `id`, `item_id`, `variant_id`, `item_name`, `variant_name`, `sku`, `quantity`, `price` (includes INCLUDED tax, excludes modifiers, discounts and ADDED tax), `gross_total_money` (includes modifiers, excludes discounts and ADDED tax), `total_money` (after discounts and all taxes), `cost`, `cost_total`, `line_note`, `line_taxes[]`, `total_discount`, `line_discounts[]`, `line_modifiers[]`. |
| Modifiers on lines | `line_modifiers[]`: `id` (modifier id), `modifier_option_id`, `name`, `option`, `price`. |
| Tenders | `payments[]`: `payment_type_id`, `name`, `type` (example `WORLDPAY`), `money_amount` (includes tips and surcharge), `paid_at`, `payment_details` (authorization_code, reference_id, entry_method, card_company, masked card_number). Payment type catalogue via `GET /payment_types`. |
| Branches | `GET /stores`, `GET /stores/{store_id}`; receipts carry `store_id`. |
| Catalogue references | `GET /items`, `GET /variants`, `GET /modifiers` (with `modifier_options[]`: id, name, price, position), `GET /taxes`, `GET /pos_devices`, `GET /merchant`, `GET /shifts` (closed shifts by store). |
| Pagination | Cursor in response body; absent on the final page. |
| Timezone | "All dates and times in the API are in UTC." Business-day cutoff is a QOS-side rule. |
| Soft deletion | Most records soft-delete; `show_deleted=true` exposes them. Receipts expose `cancelled_at`. |
| Rate limits | "The current limit is 300 requests per 300 sec per account", HTTP 429 `RATE_LIMITED`; additional resource-based limits exist but are not quantified. |
| Webhooks vs polling | Both. Webhook events: `receipts.update` (receipt created or updated), `items.update`, `inventory_levels.update`, `customers.update`, `shifts.create`. Webhooks created with a personal token are unsigned; webhooks created by an OAuth app carry `X-Loyverse-Signature` (HMAC-SHA1 of the raw body with the client secret). Retry 200 times over 48 hours, then the webhook is Disabled. Batch payloads carry at most 100 objects. Polling with `updated_at_min` plus cursor is the documented alternative. |
| Write surface (not needed) | `POST /receipts` and `POST /receipts/{receipt_number}/refund` exist. The refund API "will cause a restock of items" in Loyverse. Phase 2 must not call these. |

### 3.3 Modifier Semantics

- The spec models a Loyverse modifier as a named group with `modifier_options` (id, name, price, position). A search of the spec for `is_default`, `default_option` or `default_modifier` found nothing (verified: zero matches). On the documentation alone, Loyverse has no concept of a pre-selected default option, so `line_modifiers` would be the complete set of options the cashier selected. This is **documented-only**; P2-POS-03a and AC42 require confirmation against real receipts from the authorised account before any consumption rule is confirmed.
- Variants (`variant_id`, `variant_name`, `sku`) are separate from modifiers and must map to QOS variants, not modifier effects.

### 3.4 Gaps Versus QOS-162 and QOS-185 Needs

| Need | Status |
| --- | --- |
| Authorised account covering the Al Ain branch | unknown. Nobody has confirmed Quotes owns a Loyverse account or which `store_id` is Al Ain. |
| Read-only credential | Not possible with a personal token (all-access). Read-only is only achievable with an OAuth app restricted to `*_read` scopes. Decision needed. |
| Sandbox | None documented. Any test is against the real merchant account; the inbound test reads only, which the pack permits with owner authorisation. |
| Representative period with refunds | Depends on real trading data; the refund API must not be used to manufacture a refund (pack rule). |
| Source totals for reconciliation | Receipt-level `total_money`, `total_tax`, `total_discount` and `payments[]` plus the Shifts endpoint give independently inspectable totals. documented-only. |
| Rate limit fit | 300 requests per 5 minutes at up to 250 receipts per page is ample for a single-branch pilot period. documented-only. |

## 4. Foodics

### 4.1 Documentation and Access Model

| Topic | Finding | Grade |
| --- | --- | --- |
| Reference docs | `https://apidocs.foodics.com/core/introduction.html` (API v5) with resource pages under `/core/resources/`. Guides at `https://developers.foodics.com/guides/...`. The landing page `https://apidocs.foodics.com/` is a JavaScript shell; the section pages are static and were fetched. `https://docs.foodics.com/` did not resolve (HTTP 000). | verified |
| Base URLs | Production `api.foodics.com/v5`; sandbox `api-sandbox.foodics.com/v5`. Consoles `https://console.foodics.com` and `https://console-sandbox.foodics.com`. | verified |
| Developer app and sandbox | "Developer Applications and Sandbox accounts are created by Foodics team." The developer sends integration scope (mandatory), app redirect URL (mandatory), webhook URL and events (optional), install URL (optional in development, mandatory in production) to `support@foodics.com`. Foodics returns `client_id`, `client_secret`, `redirect_uri`, scopes, webhook settings, `install_url`. The sandbox is "a fresh account" the developer must configure (taxes, users, menu). | verified (`developers.foodics.com/guides/get-started`) |
| Auth | OAuth 2.0 `authorization_code` only. Authorise at `https://console.foodics.com/authorize?client_id=...&state=...` (sandbox: `console-sandbox.foodics.com`). Authorisation code lifetime 600 seconds. Token at `POST https://api.foodics.com/oauth/token` (sandbox `api-sandbox.foodics.com/oauth/token`). "Token doesn't expire." Revocable by the merchant in the console or by the app via `DELETE /tokens/client` (scope `tokens.limited.revoke`). `Bearer` is case-sensitive. | verified |
| Merchant-issued personal token | Not documented in v5 docs fetched. A search result referenced an older `dash.foodics.com/api-docs` v2 token flow via `support@foodics.com`; that page was not fetched. | unknown |
| Scopes relevant to inbound sales | `orders.list`, `orders.get` (full), `orders.limited.read`, `orders.limited.get` (limited; difference not documented), `general.read` (branches, categories, modifiers, products, payment methods, discounts, reasons, menu display), `operations.read` (branch business days), `inventory.transactions.read`, `inventory.settings.read`. "Your integration scope decides the API scopes Foodics grants your Developer App." The Accounting/ERP category is granted `general.read` and `orders.list`. | verified; `orders.limited.*` meaning unknown |
| Partner programme and marketplace | `https://www.foodics.com/marketplace/` lists apps; its "Become a Partner" menu points to referral and reseller programmes, not integration onboarding. The install flow applies "when your App gets officially listed in Foodics Marketplace". Approval criteria and review steps are not published. The help-centre Marketplace Integration category and the "Foodics API Adapter" article returned HTTP 403 behind a Cloudflare challenge and could not be read. | partner process unknown; help centre not fetchable |
| Cost | Not published on any page fetched. | unknown |
| Lead time | Not published. Sandbox and app creation depend on a Foodics support response. | unknown |
| Sandbox data generation | Testing orders in the sandbox requires the Foodics Cashier sandbox app ("requires an iPad running iOS 13") or API order creation. API order creation is a provider write and is outside the Phase 2 read-only boundary unless Nitesh approves it for a sandbox only. | documented-only (iPad requirement verified) |

### 4.2 Read APIs for Sales

All items **verified** from `apidocs.foodics.com` resource pages unless marked otherwise.

| Capability | Endpoint and fields |
| --- | --- |
| Order list and get | `GET /orders` (scope `orders.list` or `orders.limited.read`), `GET /orders/{orderId}` (`orders.get` or `orders.limited.get`). |
| Pagination | 50 orders per page. Paging with `page` "will be limited to 10 pages max"; the documented bulk method is `sort=reference` with `filter[reference_after]=<last reference>` (start at 0). Standard endpoints return `meta.current_page`, `meta.last_page`, `meta.total`, `meta.per_page`, `links.next`. |
| Filters | `business_date`, `business_date_before`, `business_date_after`, `branch_id`, `status`, `type`, `source`, `updated_after`, `created_on`, `updated_on`, `reference`, `reference_after`, `original_order_id`, `device_id`, `app_id`, and others. |
| Includes | `include=` comma-separated. Order-level: `branch`, `payments`, `charges`, `discount`, `coupon`, `original_order`, `combos`, `tags`, `tax_reporting_transaction`. Product-level: `products.product`, `products.options`, `products.options.modifier_option`, `products.options.taxes`, `products.taxes`, `products.voider`. `payment_method` is includable on payments. |
| Order identity | `id`, `reference`, `reference_x`, `number` ("user-friendly, not unique"), `business_date` (YYYY-MM-DD), `opened_at`, `closed_at`, `created_at`, `updated_at`; branch via include. |
| Status and type | `status`: 1 Pending, 2 Active, 3 Declined, 4 Closed, 5 Returned, 6 Joined, 7 Void, 8 Draft. `type`: 1 Dine In, 2 Pick Up, 3 Delivery, 4 Drive Thru. `source`: 1 Cashier, 2 API, 3 Call Center. |
| Financial totals | `subtotal_price`, `discount_amount`, `tax_exclusive_discount_amount`, `rounding_amount`, `total_price`; `charges[]` with `amount`, `tax_exclusive_amount`, `taxes[].pivot.amount`. Formulas published at `developers.foodics.com/guides/order-calculation-formulas` (for example `order total price = order sums + rounding amount`). |
| Lines | `products[]`: `quantity`, `returned_quantity`, `unit_price`, `discount_amount`, `total_price`, `total_cost`, `tax_exclusive_unit_price`, `tax_exclusive_total_price`, `status` (1 Pending, 2 Active, 3 Closed, 4 Moved, 5 Void, 6 Returned, 7 Declined), `is_ingredients_wasted`, `is_ingredients_returned`, `void_reason`, `voider`, `added_at`, `closed_at`. |
| Modifiers on lines | `products[].options[]`: `modifier_option` (id, name, price), `quantity`, `unit_price`, `total_price`, `total_cost`, `tax_exclusive_*`, `taxes`, `partition` (undocumented), `added_at`. Option total "= product quantity * option quantity * option unit price". |
| Tenders | `payments[]`: `payment_method` (include), `amount`, `tendered`, `tips`, `business_date`, `added_at`, `user` (null when paid via API). "change equals tendered minus amount". Payment method `type`: 1 Cash, 2 Card, 3 Other, 4 Gift Card, 5 House Account, 7 3rd party (`GET /payment_methods`, `general.read`). |
| Refunds, voids, returns | Order status 5 Returned and 7 Void; product status 5 Void and 6 Returned; `original_order` set for returns and splits; `returned_quantity` per product. Accounting guide: "ensure that amounts for returned orders (Status: 5) are deducted from completed order amounts (Status: 4)". Refund payment mechanics beyond these fields are not documented. | partially unknown |
| Branches | `GET /branches` (`general.read`): `id`, `name`, `name_localized`, `reference`, `opening_from`, `opening_to`, `inventory_end_of_day_time`, `receives_online_orders`, address fields. No timezone field. |
| Business day | `GET /branch_business_days` (`operations.read`): `business_date`, `branch`, `opened_at`, `closed_at` (UTC). Order and payment `business_date` are provider-assigned. |
| Account identity for evidence | `GET /whoami`: `business.id`, `business.name`, `business.reference`, `business.country_iso_code`, `oauth_client`, `scopes[]`, `is_owner`. Useful for the QOS-185 evidence record without exposing secrets. |
| Timezone | "Foodics API timing is UTC." Order meta includes `business_date_in_utc`. |
| Rate limits | Introduction page: "The API Rate Limit is 90 requests per minute per access token per IP address." Get Started guide: "30 requests per minute per access token per IP address." The two official pages conflict. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `retry-after`. More than 10 consecutive 429s within 10 seconds triggers a 60-second block; more than 60 invalid (401/403) requests in 60 seconds triggers a 1-hour block. On 401: "Immediately deactivate the integration." | verified, with the conflict recorded |
| Webhooks vs polling | Webhook URL is configured by Foodics at app creation or by emailing support; it must be HTTPS and answer 2xx within 5 seconds. Events: `order.created`, `order.updated`, `order.delivery.created`, `order.delivery.updated`, `customer.order.created`, `customer.order.updated`, `application.order.updated`, `customer.created`, `menu.updated`. Two retries then the event is dropped; 100 non-2xx responses in a minute blocks the URL for one hour and events are lost. No signature header is documented. Polling with `filter[updated_after]` or `reference_after` is the durable path. |
| Write surface (not needed) | `POST /orders` (`orders.limited.create`), `PUT /orders/{id}`. Phase 2 must not call these against a real business. |

### 4.3 Modifier Semantics

- The `modifier_options` resource has `id`, `sku`, `name`, `price`, `cost`, `costing_method` (1 Fixed Cost, 2 Calculate cost from ingredients), `ingredients[]`, `branches[]`, `is_active`. The page contains no `is_default` or default-quantity field (verified). Order `products[].options[]` lists option rows with `quantity`. On the documentation alone this reads as the selected options, not deltas from a default, but the docs never state it. Grade: **documented-only**; must be confirmed against real orders per P2-POS-03a and AC42.
- `combos[]` carry `combo_option` and `combo_size`; full combo orchestration is Phase 3 (pack).

### 4.4 Gaps Versus QOS-162 and QOS-185 Needs

| Need | Status |
| --- | --- |
| Developer app and sandbox | Do not exist for QOS. Requires an email to Foodics that only Nitesh may authorise. |
| Authorised business covering Azur | unknown. Nobody has confirmed Quotes owns a Foodics business, its `business.reference`, or which `branch.id` is Azur. |
| Read-only scope | Achievable: Foodics grants scopes by category; request `general.read`, `orders.list`, `operations.read` only. Whether Foodics will grant `orders.list` to a non-marketplace pilot app is unknown. |
| Production authorisation | The Quotes owner must click Authorize in `console.foodics.com`. Token does not expire; revocation is the owner's control. |
| Representative data in sandbox | Needs the iPad Cashier sandbox app or API order writes in the sandbox. Decision needed. |
| Rate limit fit | 30 or 90 requests per minute at 50 orders per page covers a single-branch pilot period; order detail requires includes, which increase payload not request count. documented-only. |
| Refund/void semantics | Status codes and `returned_quantity` are documented; payment-level refund mechanics are not. Mark Unverified until real data is inspected. |

## 5. Out-of-Scope and Adjacent Providers in the Repository

All items **verified** by inspecting the working tree at HEAD `99d8106`.

| Provider | Where | What it actually is | Why it is not Phase 2 inbound proof |
| --- | --- | --- | --- |
| FineDine | `src/db/schema.ts` (`external_menu_provider` enum with single value `finedine`; `location_external_menu_sources` with `external_menu_id`, `source_url`, `provenance_note`), `src/lib/catalogue/finedine-hbz-import.ts`, `finedine-hbz-constants.ts` (`connectionKey: "finedine.hbz-stadium"`, source `https://qr.finedinemenu.com/quotes-cafe/menu/...`), `fixtures/finedine/quotes-hbz-stadium-flat-list.json`, npm scripts `import:quotes-hbz-finedine`, `approve-publish:quotes-hbz-finedine`. | Public QR-menu catalogue import for HBZ Stadium. Reads a fixture by default; `--live` fetches the public menu page. No credentials, no sales, no tenders. | It imports products and menu sections into catalogue drafts. It never sees a receipt. Its `connection_key`, `catalogue_import_operations` (idempotency key, preview hash, apply report) and `catalogue_import_source_links` patterns are useful design precedent for QOS-164 and QOS-166, nothing more. |
| Stripe | `src/lib/checkout/stripe-provider.ts`, `stripe-webhook.ts`, `payment-config.ts` (only `PAYMENTS_MODE=sandbox` and `sk_test_*` keys accepted; live keys rejected), `src/app/api/webhooks/stripe/checkout/route.ts`, `src/lib/staff/workspace-view.ts` (`staffStripeIntegrationView` returns `connected` only when both the secret key and webhook secret are configured), `docs/stripe-sandbox-contract-v1.md` (Key Vault secrets `stripe-secret-key`, `stripe-webhook-secret` on `ca-qos-dev-api`), `scripts/verify-stripe-sandbox.ts`. | Hosted Checkout for the Quotes storefront, sandbox only. This is the only integration in the repo with real, server-derived connection state. | Outbound payments for online orders, not an inbound POS feed. Its Key Vault secret handling is the "existing secure storage" where Loyverse or Foodics credentials should live. The `StaffIntegrationsPanel` component that renders this state exists in `src/components/staff/staff-workspace-ui.tsx` and is served by the staff workspace API `integrations` section, but no page in `src/app` was found mounting the panel. |
| Lightspeed, Talabat, Deliveroo | `src/mocks/platform.ts` (`INTEGRATIONS` rows: Lightspeed POS in `error`, Deliveroo `live`, Talabat `paused`/`config_required`), `src/components/platform/integrations-screen.tsx` ("Direct port of the design prototype"; hard-coded alert "Lightspeed POS is returning errors", fake `POST /v3/orders 502` log lines, connect wizard that only toggles local state). Rendered by `/tenants/[tenantId]/integrations` and `/tenants/[tenantId]/channels/pos`, both wrapped in `SampleDataNotice` ("This screen shows illustrative data from the design prototype. It is not connected to your business yet, and changes here are not saved."). | Prototype screens over mock arrays. | No network calls, no schema, no credentials. QOS-63 explicitly excluded "inventing a Lightspeed or generic POS dashboard". Delivery marketplaces are outside Phase 2 inbound scope by the pack. |
| Prototype `P2Pos.tsx` (pack, not repo) | `reference/claude-prototype/qos/app/phase2/P2Pos.tsx`: "Simulation only; the real gate stays pending." Hard-coded `SOURCE_BRANCHES` `7781` "Quotes — Dubai Mall kiosk" and `7782` "Quotes — Al Ain"; simulated account `loyverse-sandbox@example.test`; fixed 42 records and 1,860 source total; gate "Real acceptance gate: Not run". | Design reference for the connection, mapping, fault and proof-record UX. | The branch IDs, account and totals are invented. They must not be seeded as real mappings. |

Repository facts that bound QOS-162 (all verified):

- `package.json` has `stripe` as its only payment or POS dependency; there is no Loyverse or Foodics SDK and none is published by either vendor in the docs fetched.
- `.env.example` has no Loyverse or Foodics variables. Secrets already follow a Key Vault to Container App env var pattern (`STRIPE_SECRET_KEY`, `AGENT_CREDENTIAL_ENCRYPTION_KEY` with AES-256-GCM at rest for provider OAuth tokens). The agent credential encryption pattern is a candidate home for a Foodics non-expiring token or a Loyverse refresh token, subject to QOS-164 design.
- Schema has no sales, receipt, tender, stock ledger, recipe or POS connection tables. Fifty-four migrations (`0000` to `0053`) cover catalogue, storefront, checkout, media, AI and translation only.
- `locations` carries `public_id`, `name`, `slug`, `timezone`, `status`; there is no business-day cutoff field.

## 6. Branch and Account Mapping Status for Quotes

| Requested label | Client-reported POS | Existing QOS location identity (verified in `src/lib/seed/fixtures/quotes-locations.ts`) | Mapping status |
| --- | --- | --- | --- |
| Al Ain | Loyverse (unverified client report) | `loc_quotes_hbz` "HBZ Stadium" (slug `hbz-stadium`, Asia/Dubai) and `loc_quotes_al_ain_zoo` "Al Ain Zoo" (slug `al-ain-zoo`, Asia/Dubai) both exist. Which, if either, is "Al Ain" is not recorded anywhere. | unknown. The name alone cannot confirm the match (pack rule). Needs the Loyverse `store_id` and an owner-authorised mapping to one existing `public_id`. |
| Azur Cafe | Foodics (unverified client report) | No existing location named Azur. The repo contains no "Azur" string in `src`, `scripts`, `docs` or `drizzle` (verified grep). | unknown. Either a new location record or an authorised mapping to an existing one; must not rename history. |
| Dubai | None reported | `loc_quotes_hct` "HCT Academic City" (slug `hct-academic-city`, Asia/Dubai) exists. HBZ Stadium is the FineDine-sourced catalogue location. | unknown. No POS is reported for Dubai; the Phase 2 inbound proof needs exactly one branch, so Dubai is not a candidate until a source is named. |

Rules that apply (from the pack and Linear, documented-only): existing identities and history must not be silently renamed; names can suggest but only explicit source IDs confirm; the mapping is a QOS-161/QOS-179 decision recorded with the provider `store_id` or `branch.id`.

## 7. QOS-185 Evidence Checklist and Access Dependence

Items marked **blocked** cannot be produced until a provider account is authorised. Items marked **independent** can be prepared now.

| # | Evidence item (from QOS-185, prompt 05 and the acceptance matrix) | Loyverse source of evidence | Foodics source of evidence | Status today |
| --- | --- | --- | --- | --- |
| 1 | Provider, account and environment safely identified | `GET /merchant`, `GET /stores` (account and store IDs, no secret) | `GET /whoami` (`business.id`, `business.reference`, `oauth_client`, `scopes[]`), `GET /branches` | blocked: no account |
| 2 | Authorised read scope recorded | OAuth scopes in token response, or statement that a personal token was used (all-access) | `whoami.scopes[]` | blocked |
| 3 | Mapped branch with source ID | `store_id` | `branch.id` and `branch.reference` | blocked, plus QOS-161 decision |
| 4 | Business day, timezone and cutoff | API is UTC; cutoff is a QOS policy | `business_date` provider-assigned; `branch_business_days` opened/closed; `inventory_end_of_day_time` | policy independent; data blocked |
| 5 | Actual retrieval timestamp and API version | Request time; `X-Loyverse-API-version` on webhooks; base path `v1.0` | Request time; base path `v5` | blocked |
| 6 | Source-issued record IDs | `receipt_number`, `line_items[].id`, `line_modifiers[].modifier_option_id`, `payments[].payment_type_id` | `order.id`, `order.reference`, option `modifier_option.id`, `payment_method.id` | blocked |
| 7 | Pagination and completeness proof | Cursor chain until no cursor; count versus `created_at_min/max` window | `reference_after` chain; `meta.total` on standard endpoints | blocked |
| 8 | Itemised lines, modifiers, tenders | `line_items[]`, `line_modifiers[]`, `payments[]` | `products[]`, `products[].options[]`, `payments[]` | blocked |
| 9 | Refund, void, correction cases from authorised data | `receipt_type=REFUND`, `refund_for`, `cancelled_at` | status 5 Returned, 7 Void, product status 5/6, `returned_quantity`, `original_order` | blocked; also depends on real trading containing such cases |
| 10 | Source totals for reconciliation | `total_money`, `total_tax`, `total_discount`, `payments[].money_amount`; `GET /shifts` | `total_price`, `subtotal_price`, `discount_amount`, `payments[].amount`; formulas guide | blocked |
| 11 | Modifier semantics confirmed (final selection vs default-delta) | Inspect real `line_modifiers` against the item's modifier definitions | Inspect real `options[]` against `modifier_options` | blocked; docs suggest final-selection for both but do not state it |
| 12 | Unsupported or unverified fields listed | Example: cost fields are Loyverse-side costs, not QOS recipe costs | Example: `partition`, payment-level refund mechanics | independent draft now; finalise after real data |
| 13 | Reimport idempotency, overlap, ledger, reports, Excel | QOS pipeline (QOS-163 to QOS-184) | same | independent of provider; blocked only for the real-data run |
| 14 | Reviewer, date, passed/failed/unsupported | n/a | n/a | blocked until the run |

## 8. Decisions and Requests for Nitesh

No action below has been taken. None implies sign-up or spend.

1. **Confirm account ownership.** Ask the Quotes owner whether Quotes holds a Loyverse account (and which store is Al Ain) and a Foodics business (and which branch is Azur). Record the answer in QOS-162 without credentials.
2. **Choose the pilot provider on access, not preference.** If Quotes already has a Loyverse account, Loyverse can start immediately with no third party involved. Foodics cannot start until Foodics creates a developer app.
3. **Loyverse auth path.** Decide between (a) owner-issued personal access token, which is all-access and non-scopeable, or (b) a QOS OAuth app registered at `developer.loyverse.com/apps` by Nitesh with `*_read` scopes only, which gives read-only access and signed webhooks. Option (b) is the only read-only path.
4. **Foodics developer-app request.** Decide whether to email `support@foodics.com` requesting a sandbox and developer app with integration scope "read sales for reconciliation" (category Accounting/ERP or Other), scopes `general.read`, `orders.list`, `operations.read`, a QOS redirect URL, and optionally a webhook URL. Only Nitesh sends this.
5. **Sandbox versus real read.** Loyverse has no documented sandbox, so its test reads the real account for an agreed past period. Foodics offers a sandbox, but populating it needs the iPad Cashier app or API writes. Decide which environment counts for QOS-185, bearing in mind the pack prefers an authorised real source period.
6. **Agreed branch and period.** Choose one branch and a bounded past date range that contains at least one refund or void if possible. Record it with the provider store or branch ID.
7. **Credential storage.** Confirm that provider tokens go to the existing runtime Key Vault (`kv-qos-dev-runtime`) following the Stripe pattern, and never into `.env` files, Linear, chat or this document.
8. **Branch mapping authority.** Confirm under QOS-161 which existing `public_id` (if any) Al Ain and Azur Cafe map to, and whether Azur Cafe is a new location.
9. **Cost acceptance.** Loyverse core API appears free; the Unlimited sales history add-on (USD 7/store/month) may or may not affect API history depth (unknown). Foodics cost is unpublished. Confirm no spend is authorised until this is clarified with the vendors.

## 9. Sources

| Source | URL | Grade and note |
| --- | --- | --- |
| Loyverse OpenAPI reference v1.0 | https://developer.loyverse.com/docs/API-Reference__v1.0.yaml | verified (downloaded, 142,914 bytes) |
| Loyverse API reference shell | https://developer.loyverse.com/docs/ | verified (HTML shell only; content is in the YAML) |
| Loyverse help: how to create tokens for API | https://help.loyverse.com/help/loyverse-api | verified |
| Loyverse help: connect apps from marketplace | https://help.loyverse.com/help/connect-apps-from-marketplace | verified |
| Loyverse help: add-on services | https://help.loyverse.com/help/how-use-paid-services-loyverse-pos | verified (no prices or API limits stated) |
| Loyverse pricing | https://loyverse.com/pricing | verified |
| Loyverse API overview | https://loyverse.com/loyverse-pos-api | verified |
| Loyverse developer apps dashboard | https://developer.loyverse.com/apps | not fetched (requires Loyverse sign-in); documented-only |
| Foodics API introduction (v5, rate limits, base URLs) | https://apidocs.foodics.com/core/introduction.html | verified |
| Foodics authentication | https://apidocs.foodics.com/core/authentication.html | verified |
| Foodics scopes | https://apidocs.foodics.com/core/scopes.html | verified |
| Foodics pagination | https://apidocs.foodics.com/core/pagination.html | verified |
| Foodics includables | https://apidocs.foodics.com/core/includables.html | verified |
| Foodics webhooks | https://apidocs.foodics.com/core/webhooks.html | verified |
| Foodics orders resource | https://apidocs.foodics.com/core/resources/orders.html | verified |
| Foodics modifier options resource | https://apidocs.foodics.com/core/resources/modifier_options.html | verified |
| Foodics branches resource | https://apidocs.foodics.com/core/resources/branches.html | verified |
| Foodics branch business days resource | https://apidocs.foodics.com/core/resources/branch_business_days.html | verified |
| Foodics payment methods resource | https://apidocs.foodics.com/core/resources/payment_methods.html | verified |
| Foodics whoami resource | https://apidocs.foodics.com/core/resources/whoami.html | verified |
| Foodics revoke tokens resource | https://apidocs.foodics.com/core/resources/revoke_tokens.html | verified |
| Foodics developer guides index | https://developers.foodics.com/ | verified (navigation only) |
| Foodics Get Started guide (app and sandbox creation, OAuth URLs, 30 req/min) | https://developers.foodics.com/guides/get-started | verified |
| Foodics Partnership Authentication Process | https://developers.foodics.com/guides/partnership_authentication_process | verified |
| Foodics integration categories and scopes | https://developers.foodics.com/guides/which-category-best-fits | verified |
| Foodics Accounting/ERP integration guide | https://developers.foodics.com/guides/accounting/accounting-erp-integration | verified |
| Foodics order calculation formulas | https://developers.foodics.com/guides/order-calculation-formulas | verified |
| Foodics marketplace | https://www.foodics.com/marketplace/ | verified (app listing; no partner onboarding detail) |
| Foodics help centre: Marketplace Integration category | https://help.foodics.com/hc/en-us/categories/4404592563986-Marketplace-Integration | not fetchable (HTTP 403, Cloudflare challenge); unknown |
| Foodics help centre: API Adapter / API Connector | https://help.foodics.com/hc/en-us/articles/7494382541084-Foodics-API-Adapter | not fetchable (HTTP 403); unknown |
| Foodics docs alias | https://docs.foodics.com/ | did not resolve (HTTP 000); superseded by apidocs.foodics.com |
| Linear live snapshot | `/workspace/qos-phase2/linear-live/QOS-162-QOS-185-live.md` | verified (file read) |
| Pack documents | `Start_Here.md`, `prompts/05_REAL_POS_ACCEPTANCE.md`, `linear/01_Delivery_Definition.md`, `linear/02_Grok_Execution_Protocol.md`, `linear/03_Inbound_POS_Contract.md`, `linear/04_Acceptance_Matrix.md`, `linear/QOS_Phase2_Linear_Changes.md`, `requirements/QOS_Phase2_Claude_Opus_Design_Brief.md` sections 11 and AC24/AC42, `audit/QOS_Phase2_Prototype_Audit.md`, `reference/claude-prototype/qos/app/phase2/P2Pos.tsx` | verified (files read) |
| Repository at HEAD `99d8106` | `package.json`, `.env.example`, `src/db/schema.ts`, `drizzle/`, `src/mocks/platform.ts`, `src/components/platform/integrations-screen.tsx`, `src/app/tenants/[tenantId]/integrations/page.tsx`, `src/app/tenants/[tenantId]/channels/pos/page.tsx`, `src/components/staff/sample-data-notice.tsx`, `src/components/staff/staff-workspace-ui.tsx`, `src/lib/staff/workspace-view.ts`, `src/app/api/tenants/[tenantId]/staff/workspace/route.ts`, `src/lib/checkout/payment-config.ts`, `docs/stripe-sandbox-contract-v1.md`, `src/lib/catalogue/finedine-hbz-constants.ts`, `src/lib/catalogue/finedine-hbz-import.ts`, `src/lib/seed/fixtures/quotes-locations.ts` | verified (files inspected) |
| Third-party pages surfaced by search (Make, Pipedream, apis.io, dev.to, apitracker) | various | not used as evidence; mentioned only because search returned them. Their rate-limit and add-on claims conflict with or are unsupported by official pages. |

## 10. What Was Not Done

- No Loyverse or Foodics account, developer app, sandbox or marketplace application was created, requested or applied for.
- No email, form, chat or phone contact was made with any provider.
- No live API call was made to Loyverse or Foodics. The only network activity was fetching public documentation pages and one public OpenAPI YAML file.
- No credentials, tokens or secrets were used, printed or stored. None exist for these providers in the repository or Linear.
- No feature code, tests, migrations, configuration or fixtures were written. The only file added is this document and its directory `docs/phase2/`.
- No database or Azure resource was accessed.
- No commit, push, branch, merge, deploy or remote change was made.
- No deferred outbound-order issue (QOS-157, QOS-165, QOS-171 to QOS-176, QOS-180) was touched or referenced as active work.
- No QOS-160 plan content was written; that remains with the other agent.
- The Foodics help centre could not be read because of a Cloudflare challenge; the Loyverse developer apps dashboard requires sign-in and was not entered. Claims that depend on those pages are marked unknown above.
