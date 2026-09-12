import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";

import type { DbClient } from "@/db/client";
import {
  storefrontCheckoutPaymentAttempts,
  storefrontCheckoutProviderEvents,
  storefronts,
} from "@/db/schema";
import type { CheckoutQuoteResponse } from "@/lib/checkout/checkout-quote-contract";
import type {
  CheckoutPaymentOutcomeDiagnostics,
  CheckoutPaymentOutcomeMessaging,
  CheckoutPaymentOutcomeResponse,
  CheckoutPaymentOutcomeStatus,
} from "@/lib/checkout/checkout-payment-outcome-contract";
import { CheckoutPaymentError } from "@/lib/checkout/checkout-payment-attempt";
import { resolveCustomerAccountBasketContext } from "@/lib/basket/customer-basket";
import type { BasketContextInput } from "@/lib/basket/customer-basket";
import { reconcilePaymentAttemptFromProviderSession } from "@/lib/checkout/stripe-session-lookup";
import { readCheckoutPaymentConfig } from "@/lib/checkout/payment-config";
import { withTenantContext } from "@/lib/tenant/context";
import type { TenantDbExecutor } from "@/lib/tenant/context";

const TERMINAL_OUTCOME_STATUSES = new Set<CheckoutPaymentOutcomeStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

export class CheckoutPaymentOutcomeError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CheckoutPaymentOutcomeError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class CheckoutWebhookError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "CheckoutWebhookError";
    this.statusCode = statusCode;
  }
}

export function buildOutcomeMessaging(
  status: CheckoutPaymentOutcomeStatus,
): CheckoutPaymentOutcomeMessaging {
  switch (status) {
    case "succeeded":
      return {
        titleEn: "Test payment successful",
        titleAr: "تم الدفع التجريبي بنجاح",
        bodyEn:
          "No real charge was made. This is a sandbox test only and no order will be fulfilled.",
        bodyAr:
          "لم يتم خصم أي مبلغ حقيقي. هذا اختبار تجريبي فقط ولن يتم تنفيذ أي طلب.",
      };
    case "failed":
      return {
        titleEn: "Test payment declined",
        titleAr: "تم رفض الدفع التجريبي",
        bodyEn:
          "The sandbox payment did not complete. No real charge was made and no order was created.",
        bodyAr:
          "لم يكتمل الدفع التجريبي. لم يتم خصم أي مبلغ حقيقي ولم يتم إنشاء أي طلب.",
      };
    case "cancelled":
      return {
        titleEn: "Checkout cancelled",
        titleAr: "تم إلغاء الدفع",
        bodyEn: "You left checkout before completing the sandbox payment.",
        bodyAr: "غادرت صفحة الدفع قبل إكمال الدفع التجريبي.",
      };
    case "expired":
      return {
        titleEn: "Checkout session expired",
        titleAr: "انتهت صلاحية جلسة الدفع",
        bodyEn: "The sandbox checkout session expired before payment completed.",
        bodyAr: "انتهت صلاحية جلسة الدفع التجريبية قبل اكتمال الدفع.",
      };
    case "unknown":
      return {
        titleEn: "Payment confirmation pending",
        titleAr: "تأكيد الدفع قيد الانتظار",
        bodyEn:
          "We are still confirming the sandbox payment outcome. Refresh this page shortly.",
        bodyAr: "ما زلنا نؤكد نتيجة الدفع التجريبي. حدّث الصفحة بعد قليل.",
      };
    default:
      return {
        titleEn: "Payment in progress",
        titleAr: "الدفع قيد التقدم",
        bodyEn:
          "Complete the sandbox checkout to continue. No real charge will be made.",
        bodyAr: "أكمل الدفع التجريبي للمتابعة. لن يتم خصم أي مبلغ حقيقي.",
      };
  }
}

export function resolveNextPaymentStatus(
  currentStatus: CheckoutPaymentOutcomeStatus,
  proposedStatus: CheckoutPaymentOutcomeStatus,
): CheckoutPaymentOutcomeStatus {
  if (currentStatus === proposedStatus) {
    return currentStatus;
  }

  if (TERMINAL_OUTCOME_STATUSES.has(currentStatus)) {
    return currentStatus;
  }

  return proposedStatus;
}

export function buildPaymentOutcomeResponse(input: {
  paymentAttemptPublicId: string;
  status: CheckoutPaymentOutcomeStatus;
  providerMode: "sandbox" | "fixture";
  quote: CheckoutQuoteResponse;
  providerReference?: string | null;
  reconciledAt?: Date | null;
  diagnostics?: CheckoutPaymentOutcomeDiagnostics;
}): CheckoutPaymentOutcomeResponse {
  return {
    contractVersion: 1,
    paymentAttemptPublicId: input.paymentAttemptPublicId,
    status: input.status,
    isTest: true,
    provider: "stripe",
    providerMode: input.providerMode,
    quotePublicId: input.quote.quotePublicId,
    currency: "AED",
    totalMinor: input.quote.totalMinor,
    lines: input.quote.lines,
    fees: input.quote.fees,
    discountMinor: input.quote.discountMinor,
    vatMinor: input.quote.vatMinor,
    providerReference: input.providerReference ?? undefined,
    reconciledAt: input.reconciledAt?.toISOString(),
    messaging: buildOutcomeMessaging(input.status),
    diagnostics: input.diagnostics,
  };
}

function summarizeStripeEvent(event: Stripe.Event) {
  const object = event.data.object as unknown as Record<string, unknown>;
  return {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    objectId: typeof object.id === "string" ? object.id : undefined,
    paymentAttemptPublicId:
      typeof object.metadata === "object" &&
      object.metadata !== null &&
      "payment_attempt_public_id" in object.metadata
        ? String(
            (object.metadata as Record<string, unknown>).payment_attempt_public_id,
          )
        : undefined,
    tenantId:
      typeof object.metadata === "object" &&
      object.metadata !== null &&
      "tenant_id" in object.metadata
        ? String((object.metadata as Record<string, unknown>).tenant_id)
        : undefined,
  };
}

function summarizeFixtureEvent(input: {
  providerEventId: string;
  eventType: string;
  paymentAttemptPublicId: string;
  tenantId: string;
}) {
  return {
    id: input.providerEventId,
    type: input.eventType,
    livemode: false,
    objectId: input.paymentAttemptPublicId,
    paymentAttemptPublicId: input.paymentAttemptPublicId,
    tenantId: input.tenantId,
    isLabelledFixture: true,
  };
}

function mapStripeSessionOutcome(
  session: Stripe.Checkout.Session,
): CheckoutPaymentOutcomeStatus | null {
  if (session.status === "expired") {
    return "expired";
  }

  if (session.status === "complete") {
    if (session.payment_status === "paid") {
      return "succeeded";
    }

    if (session.payment_status === "unpaid") {
      return "failed";
    }
  }

  return null;
}

function validateStripeSessionAgainstAttempt(
  session: Stripe.Checkout.Session,
  attempt: typeof storefrontCheckoutPaymentAttempts.$inferSelect,
) {
  if (session.livemode) {
    throw new CheckoutWebhookError("Live-mode Stripe events are rejected.", 400);
  }

  const metadata = session.metadata ?? {};
  const paymentAttemptPublicId = metadata.payment_attempt_public_id;
  const tenantId = metadata.tenant_id;

  if (paymentAttemptPublicId !== attempt.publicId) {
    throw new CheckoutWebhookError("Checkout session mapping mismatch.", 400);
  }

  if (tenantId !== attempt.tenantId) {
    throw new CheckoutWebhookError("Checkout session tenant mismatch.", 400);
  }

  if (session.amount_total !== attempt.amountMinor) {
    throw new CheckoutWebhookError("Checkout session amount mismatch.", 400);
  }

  if ((session.currency ?? "").toUpperCase() !== attempt.currency) {
    throw new CheckoutWebhookError("Checkout session currency mismatch.", 400);
  }

  if (
    attempt.providerReference &&
    session.id !== attempt.providerReference
  ) {
    throw new CheckoutWebhookError("Checkout session reference mismatch.", 400);
  }
}

async function loadPaymentAttemptForCustomer(
  tx: TenantDbExecutor,
  tenantId: string,
  customerUserId: string,
  paymentAttemptPublicId: string,
) {
  const [attempt] = await tx
    .select()
    .from(storefrontCheckoutPaymentAttempts)
    .where(
      and(
        eq(storefrontCheckoutPaymentAttempts.tenantId, tenantId),
        eq(storefrontCheckoutPaymentAttempts.customerUserId, customerUserId),
        eq(storefrontCheckoutPaymentAttempts.publicId, paymentAttemptPublicId),
      ),
    )
    .limit(1);

  return attempt ?? null;
}

async function loadPaymentAttemptByPublicId(
  tx: TenantDbExecutor,
  tenantId: string,
  paymentAttemptPublicId: string,
) {
  const [attempt] = await tx
    .select()
    .from(storefrontCheckoutPaymentAttempts)
    .where(
      and(
        eq(storefrontCheckoutPaymentAttempts.tenantId, tenantId),
        eq(storefrontCheckoutPaymentAttempts.publicId, paymentAttemptPublicId),
      ),
    )
    .limit(1);

  return attempt ?? null;
}

async function persistProviderEventIntake(
  tx: TenantDbExecutor,
  input: {
    tenantId: string;
    providerEventId: string;
    eventType: string;
    livemode: boolean;
    paymentAttemptId?: string | null;
    payloadSummary: Record<string, unknown>;
    processingStatus: "received" | "processed" | "rejected" | "ignored";
    rejectionReason?: string | null;
  },
) {
  const [inserted] = await tx
    .insert(storefrontCheckoutProviderEvents)
    .values({
      tenantId: input.tenantId,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      livemode: input.livemode,
      paymentAttemptId: input.paymentAttemptId ?? null,
      payloadSummary: input.payloadSummary,
      processingStatus: input.processingStatus,
      rejectionReason: input.rejectionReason ?? null,
      processedAt:
        input.processingStatus === "processed" ||
        input.processingStatus === "ignored" ||
        input.processingStatus === "rejected"
          ? new Date()
          : null,
    })
    .onConflictDoNothing({
      target: [
        storefrontCheckoutProviderEvents.provider,
        storefrontCheckoutProviderEvents.providerEventId,
      ],
    })
    .returning({ id: storefrontCheckoutProviderEvents.id });

  if (inserted) {
    return { inserted: true as const, eventId: inserted.id };
  }

  const [existing] = await tx
    .select({
      id: storefrontCheckoutProviderEvents.id,
      processingStatus: storefrontCheckoutProviderEvents.processingStatus,
    })
    .from(storefrontCheckoutProviderEvents)
    .where(
      and(
        eq(storefrontCheckoutProviderEvents.provider, "stripe"),
        eq(storefrontCheckoutProviderEvents.providerEventId, input.providerEventId),
      ),
    )
    .limit(1);

  return {
    inserted: false as const,
    eventId: existing?.id,
    alreadyProcessed: existing?.processingStatus === "processed",
  };
}

async function applyPaymentOutcome(
  tx: TenantDbExecutor,
  attempt: typeof storefrontCheckoutPaymentAttempts.$inferSelect,
  proposedStatus: CheckoutPaymentOutcomeStatus,
  input: {
    providerEventId: string;
    eventType: string;
    diagnostics?: CheckoutPaymentOutcomeDiagnostics;
  },
) {
  const quote = attempt.quoteSnapshot as CheckoutQuoteResponse;
  const nextStatus = resolveNextPaymentStatus(
    attempt.status as CheckoutPaymentOutcomeStatus,
    proposedStatus,
  );
  const reconciledAt = TERMINAL_OUTCOME_STATUSES.has(nextStatus)
    ? (attempt.reconciledAt ?? new Date())
    : attempt.reconciledAt;

  const outcome = buildPaymentOutcomeResponse({
    paymentAttemptPublicId: attempt.publicId,
    status: nextStatus,
    providerMode: attempt.providerMode,
    quote,
    providerReference: attempt.providerReference,
    reconciledAt,
    diagnostics: {
      ...input.diagnostics,
      lastEventType: input.eventType,
      lastProviderEventId: input.providerEventId,
      isLabelledFixture: input.diagnostics?.isLabelledFixture,
    },
  });

  await tx
    .update(storefrontCheckoutPaymentAttempts)
    .set({
      status: nextStatus,
      outcomeSnapshot: outcome,
      reconciledAt,
      lastProviderEventId: input.providerEventId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(storefrontCheckoutPaymentAttempts.tenantId, attempt.tenantId),
        eq(storefrontCheckoutPaymentAttempts.id, attempt.id),
      ),
    );

  return outcome;
}

export async function processVerifiedStripeCheckoutEvent(
  db: DbClient,
  event: Stripe.Event,
) {
  const summary = summarizeStripeEvent(event);

  if (event.livemode) {
    throw new CheckoutWebhookError("Live-mode Stripe events are rejected.", 400);
  }

  if (!summary.tenantId || !summary.paymentAttemptPublicId) {
    throw new CheckoutWebhookError("Stripe event metadata is incomplete.", 400);
  }

  return withTenantContext(db, summary.tenantId, async (tx) => {
    const intake = await persistProviderEventIntake(tx, {
      tenantId: summary.tenantId!,
      providerEventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      payloadSummary: summary,
      processingStatus: "received",
    });

    if (!intake.inserted && intake.alreadyProcessed) {
      return { duplicate: true as const };
    }

    const attempt = await loadPaymentAttemptByPublicId(
      tx,
      summary.tenantId!,
      summary.paymentAttemptPublicId!,
    );

    if (!attempt) {
      await tx
        .update(storefrontCheckoutProviderEvents)
        .set({
          processingStatus: "rejected",
          rejectionReason: "Unknown payment attempt mapping.",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(storefrontCheckoutProviderEvents.tenantId, summary.tenantId!),
            eq(storefrontCheckoutProviderEvents.providerEventId, event.id),
          ),
        );

      throw new CheckoutWebhookError("Unknown payment attempt mapping.", 404);
    }

    let proposedStatus: CheckoutPaymentOutcomeStatus | null = null;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      validateStripeSessionAgainstAttempt(session, attempt);
      proposedStatus = mapStripeSessionOutcome(session);
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      validateStripeSessionAgainstAttempt(session, attempt);
      proposedStatus = "expired";
    } else if (
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "payment_intent.payment_failed"
    ) {
      proposedStatus = "failed";
    } else {
      await tx
        .update(storefrontCheckoutProviderEvents)
        .set({
          paymentAttemptId: attempt.id,
          processingStatus: "ignored",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(storefrontCheckoutProviderEvents.tenantId, summary.tenantId!),
            eq(storefrontCheckoutProviderEvents.providerEventId, event.id),
          ),
        );

      return { ignored: true as const, eventType: event.type };
    }

    if (!proposedStatus) {
      await tx
        .update(storefrontCheckoutProviderEvents)
        .set({
          paymentAttemptId: attempt.id,
          processingStatus: "ignored",
          processedAt: new Date(),
        })
        .where(
          and(
            eq(storefrontCheckoutProviderEvents.tenantId, summary.tenantId!),
            eq(storefrontCheckoutProviderEvents.providerEventId, event.id),
          ),
        );

      return { ignored: true as const, eventType: event.type };
    }

    const currentStatus = attempt.status as CheckoutPaymentOutcomeStatus;
    const nextStatus = resolveNextPaymentStatus(currentStatus, proposedStatus);
    const ignoredDueToTerminal =
      TERMINAL_OUTCOME_STATUSES.has(currentStatus) &&
      currentStatus !== proposedStatus;

    const outcome = await applyPaymentOutcome(tx, attempt, proposedStatus, {
      providerEventId: event.id,
      eventType: event.type,
      diagnostics: { isLabelledFixture: false },
    });

    await tx
      .update(storefrontCheckoutProviderEvents)
      .set({
        paymentAttemptId: attempt.id,
        processingStatus: ignoredDueToTerminal ? "ignored" : "processed",
        rejectionReason: ignoredDueToTerminal
          ? "Terminal payment state already recorded."
          : null,
        processedAt: new Date(),
      })
      .where(
        and(
          eq(storefrontCheckoutProviderEvents.tenantId, summary.tenantId!),
          eq(storefrontCheckoutProviderEvents.providerEventId, event.id),
        ),
      );

    return {
      duplicate: false as const,
      outcome,
      status: nextStatus,
      ignoredDueToTerminal,
    };
  });
}

export async function reconcileLabelledFixturePaymentOutcome(
  db: DbClient,
  input: {
    tenantId: string;
    paymentAttemptPublicId: string;
    outcome: Extract<CheckoutPaymentOutcomeStatus, "succeeded" | "failed" | "cancelled">;
    fixtureEventId?: string;
  },
) {
  const providerEventId =
    input.fixtureEventId ?? `evt_fixture_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const eventType =
    input.outcome === "succeeded"
      ? "checkout.session.completed"
      : input.outcome === "cancelled"
        ? "checkout.session.expired"
        : "payment_intent.payment_failed";

  return withTenantContext(db, input.tenantId, async (tx) => {
    const payloadSummary = summarizeFixtureEvent({
      providerEventId,
      eventType,
      paymentAttemptPublicId: input.paymentAttemptPublicId,
      tenantId: input.tenantId,
    });

    const intake = await persistProviderEventIntake(tx, {
      tenantId: input.tenantId,
      providerEventId,
      eventType,
      livemode: false,
      payloadSummary,
      processingStatus: "received",
    });

    if (!intake.inserted && intake.alreadyProcessed) {
      const attempt = await loadPaymentAttemptByPublicId(
        tx,
        input.tenantId,
        input.paymentAttemptPublicId,
      );

      if (attempt?.outcomeSnapshot) {
        return attempt.outcomeSnapshot as CheckoutPaymentOutcomeResponse;
      }
    }

    const attempt = await loadPaymentAttemptByPublicId(
      tx,
      input.tenantId,
      input.paymentAttemptPublicId,
    );

    if (!attempt) {
      throw new CheckoutPaymentOutcomeError("Payment attempt not found.", 404);
    }

    if (attempt.providerMode !== "fixture") {
      throw new CheckoutPaymentOutcomeError(
        "Fixture reconciliation is only permitted for labelled fixture attempts.",
        403,
      );
    }

    const outcome = await applyPaymentOutcome(tx, attempt, input.outcome, {
      providerEventId,
      eventType,
      diagnostics: { isLabelledFixture: true },
    });

    await tx
      .update(storefrontCheckoutProviderEvents)
      .set({
        paymentAttemptId: attempt.id,
        processingStatus: "processed",
        processedAt: new Date(),
      })
      .where(
        and(
          eq(storefrontCheckoutProviderEvents.tenantId, input.tenantId),
          eq(storefrontCheckoutProviderEvents.providerEventId, providerEventId),
        ),
      );

    return outcome;
  });
}

export async function getAuthenticatedPaymentOutcome(
  db: DbClient,
  request: Request,
  contextInput: BasketContextInput,
  paymentAttemptPublicId: string,
) {
  if (!paymentAttemptPublicId.trim()) {
    throw new CheckoutPaymentOutcomeError(
      "paymentAttemptPublicId is required.",
      400,
      "paymentAttemptPublicId",
    );
  }

  const accountContext = await resolveCustomerAccountBasketContext(
    db,
    request,
    contextInput,
  );

  return withTenantContext(db, accountContext.tenantId, async (tx) => {
    let attempt = await loadPaymentAttemptForCustomer(
      tx,
      accountContext.tenantId,
      accountContext.customerUserId,
      paymentAttemptPublicId.trim(),
    );

    if (!attempt) {
      throw new CheckoutPaymentOutcomeError("Payment attempt not found.", 404);
    }

    const paymentConfig = readCheckoutPaymentConfig();
    if (
      (attempt.status === "unknown" || attempt.status === "provider_handoff") &&
      attempt.providerReference &&
      attempt.providerMode === "sandbox" &&
      paymentConfig.stripeSecretKey
    ) {
      await reconcilePaymentAttemptFromProviderSession(
        db,
        accountContext.tenantId,
        attempt.providerReference,
      );

      attempt =
        (await loadPaymentAttemptForCustomer(
          tx,
          accountContext.tenantId,
          accountContext.customerUserId,
          paymentAttemptPublicId.trim(),
        )) ?? attempt;
    }

    if (attempt.outcomeSnapshot) {
      return attempt.outcomeSnapshot as CheckoutPaymentOutcomeResponse;
    }

    const quote = attempt.quoteSnapshot as CheckoutQuoteResponse;

    return buildPaymentOutcomeResponse({
      paymentAttemptPublicId: attempt.publicId,
      status: attempt.status as CheckoutPaymentOutcomeStatus,
      providerMode: attempt.providerMode,
      quote,
      providerReference: attempt.providerReference,
      reconciledAt: attempt.reconciledAt,
      diagnostics: attempt.providerMode === "fixture"
        ? { isLabelledFixture: true }
        : undefined,
    });
  });
}

export async function resolveTenantIdFromStorefrontPublicId(
  db: DbClient,
  storefrontPublicId: string,
) {
  const [storefront] = await db
    .select({ tenantId: storefronts.tenantId })
    .from(storefronts)
    .where(eq(storefronts.publicId, storefrontPublicId.trim()))
    .limit(1);

  if (!storefront) {
    throw new CheckoutPaymentError("Storefront not found.", 404, "storefrontPublicId");
  }

  return storefront.tenantId;
}

export function checkoutPaymentOutcomePrivateCacheControl() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}
