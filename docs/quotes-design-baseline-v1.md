# Quotes design baseline v1 (QOS-32)

Status: **inspected baseline** — 12 September 2026  
Linear: [QOS-32](https://linear.app/qosapp/issue/QOS-32/inspect-the-quotes-sample-and-record-the-close-reproduction-design)

This document records a sanitized inventory of the existing Quotes sample repository so Phase 1 storefront work preserves its visual fidelity while wiring QOS as the authoritative catalogue, pricing, basket, auth and checkout backend. It does **not** claim EN/AR parity, AED pricing, or live QOS integration — those are downstream implementation issues.

---

## 1. Inspected source

| Item | Value |
| --- | --- |
| Repository | `https://github.com/niteshrajgopal-dev/quotes` |
| Local path inspected | `C:\Dev\quotes` |
| Branch | `main` |
| Commit | `47e7760ca4839fce003432f1bfd3e525fd918c2e` |
| Commit message | *Build the quotes coffee web app from the supplied design system* |
| Design export | `design/Quotes-Coffee-Design-System.zip` → `design/extracted/` |

**Not inspected in this pass:** runtime screenshots at the full responsive matrix (scripts exist: `npm run verify:shots`), licensed Recoleta font binaries, owner approval of pixel-level fidelity baselines.

---

## 2. Technology inventory

| Layer | Quotes sample | QOS Phase 1 target |
| --- | --- | --- |
| Framework | Next.js **16.3.3**, App Router, Turbopack | Same generation (shared storefront renderer per QOS-52) |
| UI | React **19.2.8**, Tailwind CSS **4.3.3** (`@theme` in `globals.css`) | Reuse token mapping; align with QOS storefront manifest theme contract (QOS-51) |
| State | Zustand **5.0.15** + `localStorage` | Replace cart/order/loyalty persistence with QOS public basket + customer APIs |
| Auth | **None** | QOS customer auth (QOS-22) via Quotes UI (QOS-36) |
| Payment | Client-only card form + simulated delay | QOS checkout quote + Stripe sandbox handoff (QOS-26/43/44/39) |
| Deployment | `output: "standalone"` Docker image on port 3000 | Shared `ca-qos-dev-storefront` runtime (QOS-54) |
| i18n | **English only** (`lang="en"`, `en-GB` dates, **GBP £**) | Explicit EN/AR selector + RTL (QOS-34); **AED** from QOS APIs |

No `process.env` / `NEXT_PUBLIC_*` usage in Quotes today. The only QOS naming is `/api/health` returning `service: "qos-storefront"`.

---

## 3. Route and screen reuse map

Legend: **Keep** = preserve layout/visual patterns; **Reuse shell** = keep chrome/components; **Replace data** = same UI, QOS-backed data; **Change** = material UX/copy/currency/locale changes; **Defer** = out of Phase 1 demo path; **New** = no existing screen.

| Screen (QOS-32) | Quotes route / file | Decision | Notes |
| --- | --- | --- | --- |
| **Home** | `/` → `(site)/page.tsx` | **Keep + Replace data** | Hero, featured items, locations teaser map well to manifest content blocks + published menu highlights. Loyalty/journal sections are **Defer** for demo checkout path unless manifest includes them. |
| **Menu (browse)** | `/menu` → `(site)/menu/page.tsx` | **Reuse shell + Replace data** | Category board layout is the reference for branch menu rendering (QOS-35). Static `src/lib/menu.ts` → QOS public menu API. |
| **Shop catalogue** | `/shop`, `/shop/[slug]` | **Defer** (retail bags) | Bag catalogue + configurator is a second commerce mode (retail SKUs). Phase 1 demo path is hospitality **menu + options** (`/menu`, `/order`), not mail-order coffee bags. |
| **Product / options** | `/order` → `(site)/order/page.tsx` + `components/order/order-flow.tsx` | **Keep + Replace data** | Five-step mobile order flow is the closest product/options reference. Wire variant/modifier IDs to QOS canonical IDs (QOS-17/19 when available; default variant only until then). |
| **Product detail (café item)** | Embedded in order flow + `/menu` cards | **Reuse patterns** | Option groups (milks, syrups, sizes) in `menu.ts` are **mock** — replace with QOS modifier contracts when QOS-19 lands; until then single-variant lines only. |
| **Basket** | Cart drawer → `components/shell/cart-drawer.tsx` + `components/cart/*` | **Keep + Replace data** | Drawer + line row + summary layout is the basket UI baseline (QOS-38). Remove client-side promo math (`SECONDCUP`, delivery £3.50); show QOS-authoritative quote breakdown. |
| **Checkout** | `/checkout` → `(site)/checkout/page.tsx` + `checkout-form.tsx` | **Change** | Keep two-column checkout layout and order summary panel. **Remove** inline card capture and UK address/postcode assumptions. Replace with: authenticated customer gate → QOS checkout quote → provider handoff → return/status polling (QOS-39). |
| **Sign-in** | *None* | **New** | Registration/sign-in/recovery screens must be added (QOS-36). Style using existing form primitives (`components/ui/field.tsx`, `button.tsx`, shell typography). |
| **Confirmation** | `/orders/[reference]` → `(site)/orders/[reference]/page.tsx` | **Change** | Keep confirmation layout (reference hero, line recap, status tone). Replace client-generated `QT-XXXX` refs with backend payment attempt / checkout outcome (QOS-44/39). Add explicit test/no-charge/no-fulfilment copy. |
| **Basket merge choice** | *None* | **New** | Explicit keep/merge dialog after sign-in (QOS-46) — no Quotes precedent; follow Quotes visual language (sheet/dialog patterns in `components/ui/sheet.tsx`). |
| **Locations** | `/locations` → `(site)/locations/page.tsx` | **Replace data** | Layout reusable; static Manchester cafés → QOS tenant locations (QOS-10 seeded branches). |
| **Loyalty** | `/loyalty` | **Defer** | Fully local mock (`stores/loyalty.ts`). Not on demo checkout critical path. |
| **Journal** | `/journal`, `/journal/[slug]` | **Defer** | Editorial content; optional manifest block later (QOS-48). |
| **Design-system docs** | `/design-system/*` | **Keep internal** | Remains developer reference; must not leak into customer shell (already separated in `(site)/layout.tsx` vs `design-system/layout.tsx`). |

### Responsive / shell components to preserve

| Component | Path | Reuse |
| --- | --- | --- |
| Site header (sticky) | `src/components/shell/site-header.tsx` | Yes — add EN/AR selector slot (QOS-34) |
| Mobile tab bar | `src/components/shell/mobile-tab-bar.tsx` | Yes |
| Cart drawer | `src/components/shell/cart-drawer.tsx` | Yes — wire to QOS basket |
| Footer | `src/components/shell/site-footer.tsx` | Yes |
| UI primitives | `src/components/ui/*` | Yes — buttons, fields, sheet, toast, tabs |
| Brand marks | `src/components/brand/logo.tsx`, `bean.tsx` | Yes — theme tokens from manifest may override accent usage |

---

## 4. Mock vs functioning integration

| Concern | Quotes sample today | Phase 1 QOS-backed target |
| --- | --- | --- |
| Product catalogue | Static arrays in `src/lib/catalog.ts`, `menu.ts` | `GET /api/public/menus/{publicKey}` or tenant menu resolver (QOS-37) |
| Prices / totals | Client `computeTotals()` in `stores/cart.ts` | Checkout quote API (QOS-26); basket mutations return versioned server totals |
| Cart persistence | `localStorage` key `quotes.cart.v1` | Anonymous basket (QOS-49) + account basket (QOS-24) |
| Coupons / fees | Hardcoded promo codes + £3.50 delivery | QOS pricing policy (`docs/checkout-pricing-test-policy-v1.md`) |
| Orders / references | Client `makeReference()` → `QT-XXXX` | Payment attempt public ID + outcome snapshot (QOS-43/44) |
| Payment | Browser validation + `setTimeout(900)` | Stripe sandbox handoff or labelled fixture (QOS-43/30) |
| Auth / sessions | None | `/api/auth/*` customer better-auth (QOS-22) |
| Storefront config | Hardcoded brand copy in `src/lib/brand.ts` | Storefront manifest (QOS-51) + host resolution (QOS-53) |
| Media | CSS gradient “plates” only | QOS public media derivatives where published |
| Loyalty | Local stamp card | **Not in Phase 1 demo scope** |

**Rule:** No catalogue, pricing, coupon, or payment rules may remain duplicated in Quotes after QOS-52 refactor. Client code may format/display QOS numbers only.

---

## 5. QOS public API dependencies (Quotes consumer)

Quotes (shared storefront renderer) should call these QOS APIs — already implemented in `qosapp` unless noted:

| Capability | QOS endpoint / contract | Linear |
| --- | --- | --- |
| Host → storefront | `GET /api/public/storefronts/host` | QOS-53 |
| Storefront manifest | `GET /api/public/storefronts/{storefrontPublicId}/manifest` | QOS-51 ✓ |
| Published menu | `GET /api/public/menus/{publicKey}` | QOS-37 ✓ |
| Public media | `GET /api/public/media/{publicDerivativeId}` | QOS-23 ✓ |
| Anonymous basket | `/api/public/baskets/current/*` | QOS-49 ✓ |
| Account basket | `/api/public/baskets/account/current/*` | QOS-24 ✓ |
| Basket merge preview/commit | `/api/public/baskets/merge/preview`, `.../commit` | QOS-45 ✓ |
| Customer auth | `/api/auth/*` | QOS-22 ✓ |
| Customer profile | `GET /api/public/customers/me` | QOS-22 ✓ |
| Checkout quote | `POST .../checkout-quote` | QOS-26 ✓ |
| Payment attempt | `POST /api/public/checkout/payment-attempts` | QOS-43 ✓ |
| Payment outcome | `GET /api/public/checkout/payment-attempts/{id}` | QOS-44 ✓ |
| Stripe webhook | `POST /api/webhooks/stripe/checkout` (server-side only) | QOS-44 ✓ |

Quotes must **not** hold PostgreSQL credentials, staff auth, operator keys, or Stripe secrets.

---

## 6. Visual tokens and assets

### Palette (verbatim from brand guide — `design/extracted/brand-spec.md`)

| Token | Hex | Usage |
| --- | --- | --- |
| Espresso | `#2F2322` | Primary ink, nav, primary buttons |
| Mocha | `#4A3836` | Elevated dark surfaces |
| Latte | `#CBB792` | Accent — rationed (≤2 per screen) |
| Cream | `#F5F1E9` | Default canvas (not pure white) |

Implemented in `src/app/globals.css` as `@theme` colour tokens.

### Typography

| Role | Quotes implementation | Brand intent | License note |
| --- | --- | --- | --- |
| Display / voice | **Young Serif** (Google Fonts) | Recoleta Bold | Young Serif is a stand-in; **Recoleta requires separate license** — do not ship Recoleta binaries from design export without confirmation |
| Body / UI | **Inter** (Google Fonts) | Inter (brand-specified) | OK via Google Fonts |
| Mono | **IBM Plex Mono** | Tabular prices, codes | OK via Google Fonts |

### Logo and imagery

| Asset | Path | Notes |
| --- | --- | --- |
| Canonical wordmark | `public/brand/quotes-logo.png`, `design/extracted/logo.png` | Do not redraw/recolour |
| Brand guide raster | `public/brand/quotes-branding-guide.png` | Reference only |
| Bean mark | `src/components/brand/bean.tsx` (SVG) | Derived motif — keep sparingly |
| Product photography | CSS plates in `components/ui/plate.tsx` | Replace with QOS-approved derivatives when available |

---

## 7. Known gaps and blockers

| Gap | Impact | Owner / follow-up |
| --- | --- | --- |
| **No EN/AR or RTL** | QOS-34 must add selector + RTL layout before Quotes demo acceptance | QOS-34 |
| **GBP / UK locales** | All prices and copy assume UK; demo requires **AED** and approved EN/AR strings from QOS | QOS-35/38 + translation publication |
| **No sign-in UI** | Checkout gate cannot be implemented without new screens | QOS-36 |
| **Mock payment** | Current checkout simulates success locally | QOS-39 + QOS-30 (real Stripe sandbox) |
| **Retail `/shop` vs café `/menu`** | Two commerce metaphors; demo path is hospitality menu | Scope `/shop` to post-demo or manifest-gated |
| **Loyalty / journal** | Rich UI but entirely local | Defer unless manifest blocks require them |
| **Modifier groups** | Café options are static | QOS-19 for server-enforced modifier rules |
| **Recoleta license** | Display font is substituted | Confirm licensed webfont before claiming brand parity |
| **Owner visual approval** | This doc is engineering inventory, not signed-off design approval | Nitesh review per QOS-32 acceptance #2 |
| **Real menu content** | Sample uses fictional Manchester data | QOS-10 seed + publish for Quotes branches |

---

## 8. Recommended implementation sequence (post QOS-32)

1. **QOS-52** — Refactor Quotes into tenant #1 of shared renderer; remove hardcoded tenant constants.  
2. **QOS-34** — EN/AR selector + RTL.  
3. **QOS-53** — Host-based storefront resolution.  
4. **QOS-35** — Menu rendering from QOS published APIs.  
5. **QOS-36** — Customer sign-in/register UI.  
6. **QOS-38** — Basket wired to QOS mutations + authoritative quote display.  
7. **QOS-46** — Post-sign-in basket merge dialog.  
8. **QOS-39** — Checkout handoff + outcome recovery UI (fixture first; Stripe when QOS-30 complete).

---

## 9. Verification commands (Quotes repo)

```bash
cd C:\Dev\quotes
npm install
npm run typecheck
npm run build
npm run verify:shots    # requires app on :3100
npm run verify:smoke    # end-to-end local mock purchase path
```

These verify the **sample** only. QOS integration acceptance requires separate contract tests against `qosapp` APIs.
