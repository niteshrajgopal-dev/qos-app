# Checkout pricing test policy v1 (synthetic fixtures)

Status: **Phase 1 synthetic test configuration** for arithmetic contract development and QOS-26 fixture tests.

This document does **not** assert UAE statutory tax rates, real merchant pricing, delivery fulfilment, revenue recognition or currency conversion. All numeric values are explicitly synthetic test fixtures.

## Policy identifier

| Field | Value |
| --- | --- |
| `policyVersion` | `1` |
| `currency` | `AED` |
| `minorUnit` | fils (1 AED = 100 fils) |
| `isTest` | `true` |

## Core decisions

| Topic | Selected test value | Notes |
| --- | --- | --- |
| Menu line price tax treatment | **Tax-exclusive** | Basket `unitPrice.amountMinor` values exclude VAT. VAT is computed at quote time. |
| Test VAT rate | **5.00%** (`vatRateBps = 500`) | Synthetic test rate only. |
| Rounding | **Half-up to nearest fil** at each monetary stage | Applies to discount, fee, VAT and total. |
| Coupon stacking | **One coupon at a time** | No implicit stacking. |
| Service fee | **Fixed 200 fils (AED 2.00)** | Applied after coupon discount; **taxable**. |
| Delivery fee | **Inactive (`mode = inactive`)** | Capability retained; demo default charges 0 and does not collect an address. |
| Negative totals | **Prevented** | Discount is capped at pre-discount merchandise subtotal. |

## Calculation order

1. Merchandise subtotal = sum(line quantity × unit price minor).
2. Coupon discount (if eligible) on merchandise subtotal only.
3. Discounted merchandise subtotal = subtotal − discount (minimum 0).
4. Service fee (if active) added to taxable base when configured as taxable.
5. Taxable amount = discounted merchandise subtotal + taxable fees.
6. VAT = round half-up(taxable amount × `vatRateBps` ÷ 10 000).
7. Total = taxable amount + VAT + non-taxable fees.

Delivery fee remains 0 under the inactive demo default.

## Coupon capability schema

| Field | Supported in v1 fixtures |
| --- | --- |
| Types | `fixed`, `percent` |
| Case handling | Codes matched case-insensitively after trim |
| Minimum spend | Enforced on merchandise subtotal before discount |
| Percentage cap | `maxDiscountMinor` caps percent coupons |
| Eligibility scope | Global synthetic fixtures only in v1 (product/location/customer scoping deferred to QOS-26 persistence) |
| Validity window | `validFrom` / `validUntil` (ISO timestamps, inclusive start, exclusive end) |
| Failed/expired attempts | Return explicit rejection; do not silently apply zero discount while claiming success |

## Worked examples (executable fixtures)

All amounts in fils unless noted.

### Example 1 — Normal basket (no coupon)

| Input | Value |
| --- | --- |
| Lines | 2 × 1800 + 1 × 2000 |
| Coupon | none |

| Output | Value |
| --- | --- |
| Merchandise subtotal | 5600 |
| Discount | 0 |
| Service fee | 200 |
| Taxable amount | 5800 |
| VAT (5%) | 290 |
| **Total** | **6090** |

### Example 2 — Eligible percent coupon `SAVE10`

| Input | Value |
| --- | --- |
| Lines | 2 × 1800 + 1 × 2000 |
| Coupon | `SAVE10` — 10%, min spend 5000, max discount 1000 |

| Output | Value |
| --- | --- |
| Merchandise subtotal | 5600 |
| Discount | 560 |
| Service fee | 200 |
| Taxable amount | 5240 |
| VAT (5%) | 262 |
| **Total** | **5502** |

### Example 3 — Ineligible expired coupon `EXPIRED10`

| Input | Value |
| --- | --- |
| Lines | 2 × 1800 + 1 × 2000 |
| Coupon | `EXPIRED10` (valid until 2020-01-01) |

| Output | Value |
| --- | --- |
| Result | Rejected — `coupon_expired` |
| Merchandise subtotal | n/a (no payable quote produced) |

### Example 4 — Fixed coupon plus fees/tax `AED5OFF`

| Input | Value |
| --- | --- |
| Lines | 2 × 1800 + 1 × 2000 |
| Coupon | `AED5OFF` — fixed 500 fils |

| Output | Value |
| --- | --- |
| Merchandise subtotal | 5600 |
| Discount | 500 |
| Service fee | 200 |
| Taxable amount | 5300 |
| VAT (5%) | 265 |
| **Total** | **5565** |

### Example 5 — Rounding boundary

| Input | Value |
| --- | --- |
| Lines | 1 × 3 |
| Coupon | `HALF` — 50% |

| Output | Value |
| --- | --- |
| Merchandise subtotal | 3 |
| Discount | 2 |
| Service fee | 200 |
| Taxable amount | 201 |
| VAT (5%) | 10 |
| **Total** | **211** |

## Code references

- Policy fixture: `src/lib/checkout/pricing-policy.ts`
- Arithmetic: `src/lib/checkout/pricing-arithmetic.ts`
- Executable tests: `src/lib/checkout/pricing-arithmetic.test.ts`

QOS-26 should import this policy version and fixtures rather than duplicating arithmetic.
