"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  productFixHref,
  severityLabel,
  SEVERITY_BADGE_TONE,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-view";
import {
  askButtonLabel,
  failureCopy,
  findingClaims,
  isActiveRunStatus,
  isMenuManagerAskDisabled,
  canAcceptSuggestions,
  isReviewOutdated,
  newIdempotencyKey,
  nextPollDelayMs,
  productNameLookup,
  readMenuManagerResult,
  runStatusCopy,
  suggestionFieldLabel,
  suggestionIdentityKey,
  unresolvedRestartCopy,
  type MenuManagerRunLike,
  type MenuManagerSuggestion,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-view";
import {
  menusCopy,
  menusCount,
  type MenusCopyKey,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { IntelligenceCard } from "@/design-system/components/intelligence/IntelligenceCard";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

type MenuManagerSectionProps = {
  tenantId: string;
  menuPublicId: string;
  menuVersion: number;
  report: MenuHealthReport | null;
  selectedProductPublicIds: string[];
  onClearSelection: () => void;
};

type RunPayload = {
  run?: MenuManagerRunLike | null;
  readyRun?: MenuManagerRunLike | null;
  error?: string;
  code?: string;
  activeRunPublicId?: string;
  unresolvedRunPublicId?: string;
};

function applyRunsPayload(
  payload: RunPayload,
  setRun: (run: MenuManagerRunLike | null) => void,
  setReadyRun: (run: MenuManagerRunLike | null) => void,
  setAccepted: (value: { runPublicId: string; keys: Set<string> } | null) => void,
) {
  setRun(payload.run ?? null);
  setReadyRun(payload.readyRun ?? null);
  const display = payload.readyRun ?? payload.run;
  if (display?.acceptedSuggestionKeys?.length) {
    setAccepted({
      runPublicId: display.publicId,
      keys: new Set(display.acceptedSuggestionKeys),
    });
  }
}

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as RunPayload;
}

export function MenuManagerSection({
  tenantId,
  menuPublicId,
  menuVersion,
  report,
  selectedProductPublicIds,
  onClearSelection,
}: MenuManagerSectionProps) {
  const { locale } = useStaffLocale();
  const copy = (key: MenusCopyKey, values?: Record<string, string | number>) =>
    menusCopy(locale, key, values);
  const [run, setRun] = useState<MenuManagerRunLike | null>(null);
  const [readyRun, setReadyRun] = useState<MenuManagerRunLike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** Kept until QOS answers, so a retried request after a network drop replays instead of duplicating. */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ runPublicId: string; keys: Set<string> } | null>(null);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  /** Set when QOS refused a new review until the user confirms this unresolved one. */
  const [unresolvedRunPublicId, setUnresolvedRunPublicId] = useState<string | null>(null);

  const runsPath = `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/agent-runs`;

  const loadRun = useCallback(
    async (runPublicId: string) => {
      const response = await staffApiFetch(`${runsPath}/${runPublicId}`);
      const payload = await readPayload(response);
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? menusCopy(locale, "managerUnableToLoadReview"));
      }
      applyRunsPayload(payload, setRun, setReadyRun, setAccepted);
      setError(null);
    },
    [locale, runsPath],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await staffApiFetch(runsPath);
        const payload = await readPayload(response);
        if (!cancelled && response.ok) {
          applyRunsPayload(payload, setRun, setReadyRun, setAccepted);
        }
      } catch {
        // The latest review is optional context; asking still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runsPath]);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!run || !visible) {
      return;
    }
    const delay = nextPollDelayMs(run);
    if (delay === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      loadRun(run.publicId).catch((pollError: unknown) => {
        setError(
          pollError instanceof Error ? pollError.message : menusCopy(locale, "managerUnableToLoadReview"),
        );
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [loadRun, locale, run, visible]);

  async function ask(acknowledgeUnresolvedRunPublicId?: string) {
    const idempotencyKey = pendingKey ?? newIdempotencyKey();
    setPendingKey(idempotencyKey);
    setAsking(true);
    setError(null);
    try {
      const response = await staffApiFetch(runsPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          ...(selectedProductPublicIds.length > 0 ? { selectedProductPublicIds } : {}),
          ...(acknowledgeUnresolvedRunPublicId ? { acknowledgeUnresolvedRunPublicId } : {}),
        }),
      });
      const payload = await readPayload(response);
      setPendingKey(null);

      if (response.ok && payload.run) {
        applyRunsPayload(payload, setRun, setReadyRun, setAccepted);
        setUnresolvedRunPublicId(null);
        onClearSelection();
        return;
      }
      if (payload.code === "run_in_progress" && payload.activeRunPublicId) {
        setError(copy("managerRunInProgress"));
        await loadRun(payload.activeRunPublicId);
        return;
      }
      if (payload.code === "unresolved_previous_run" && payload.unresolvedRunPublicId) {
        setUnresolvedRunPublicId(payload.unresolvedRunPublicId);
        return;
      }
      setError(payload.error ?? copy("managerUnableToStart"));
    } catch {
      setError(copy("managerUnreachable"));
    } finally {
      setAsking(false);
    }
  }

  async function acceptSuggestion(suggestion: MenuManagerSuggestion) {
    const acceptRun = readyRun ?? run;
    if (!acceptRun) {
      return;
    }
    const key = suggestionIdentityKey(suggestion);
    setAcceptingKey(key);
    setError(null);
    try {
      const response = await staffApiFetch(`${runsPath}/${acceptRun.publicId}/suggestions/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productPublicId: suggestion.productPublicId,
          field: suggestion.field,
          proposedText: suggestion.proposedText,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        acceptedSuggestionKeys?: string[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? copy("managerUnableToApply"));
      }
      setAccepted({
        runPublicId: acceptRun.publicId,
        keys: new Set(payload.acceptedSuggestionKeys ?? [key]),
      });
    } catch (acceptError: unknown) {
      setError(acceptError instanceof Error ? acceptError.message : copy("managerUnableToApply"));
    } finally {
      setAcceptingKey(null);
    }
  }

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  }

  const active = run ? isActiveRunStatus(run.status) : false;
  const askDisabled = isMenuManagerAskDisabled({
    runStatus: run?.status ?? null,
    unresolvedRunPublicId,
  });
  const status = run ? runStatusCopy(run, locale) : null;
  const reviewRun = readyRun ?? (run?.status === "completed" ? run : null);
  const result = reviewRun ? readMenuManagerResult(reviewRun.result) : null;
  const showingReadyAfterFailure = readyRun !== null && run?.status === "failed";
  const acceptEnabled = result ? canAcceptSuggestions(result, menuVersion) : false;
  const productName = productNameLookup(report);
  const selectedCount = selectedProductPublicIds.length;

  const intelligenceLabel = (kindKey: MenusCopyKey) =>
    copy("managerIntelligenceKind", { kind: copy(kindKey) });
  const factKind = copy("claimSystemFact");
  const markFacts = (claims: Array<{ kind: string; text: string }>) =>
    claims.map((claim) => ({ ...claim, isFact: claim.kind === factKind }));

  return (
    <section className="qosp-editor-section qosp-glass" aria-labelledby="menu-manager-title">
      <div className="qosp-section-head">
        <div>
          <h2 id="menu-manager-title" className="qosp-panel-title">
            {copy("managerTitle")}
          </h2>
          <p className="qosp-panel-help">{copy("managerSubtitle")}</p>
        </div>
        <Button
          variant="intelligence"
          size="sm"
          icon="sparkles"
          loading={asking}
          disabled={askDisabled}
          onClick={() =>
            void ask(run?.status === "failed" && run.remoteOutcomeUnknown ? run.publicId : undefined)
          }
        >
          {run && !active
            ? selectedCount > 0
              ? askButtonLabel(selectedCount, locale)
              : run.remoteOutcomeUnknown
                ? copy("managerStartNewReview")
                : copy("managerAskAgain")
            : askButtonLabel(selectedCount, locale)}
        </Button>
      </div>

      <div className="qosp-panel-body qosp-stack">
        {selectedCount > 0 ? (
          <p className="qosp-meta-line">
            {menusCount(locale, "selectedFromHealth", selectedCount)}{" "}
            <button type="button" className="qos-btn" data-variant="ghost" data-size="sm" onClick={onClearSelection}>
              {copy("managerClearSelection")}
            </button>
          </p>
        ) : null}

        {error ? (
          <Alert tone="error" title={copy("managerTitle")}>
            {error}
          </Alert>
        ) : null}

        {unresolvedRunPublicId ? (
          <Alert
            tone="warning"
            title={copy("managerStartNewReviewQuestion")}
            actions={
              <>
                <Button
                  variant="intelligence"
                  size="sm"
                  loading={asking}
                  onClick={() => void ask(unresolvedRunPublicId)}
                >
                  {copy("managerStartNewReview")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setUnresolvedRunPublicId(null)}>
                  {staffUiCopy(locale, "cancel")}
                </Button>
              </>
            }
          >
            {unresolvedRestartCopy(locale)}
          </Alert>
        ) : null}

        {run && status ? (
          <Alert tone={status.tone} title={status.title}>
            {run.status === "failed" && run.remoteOutcomeUnknown
              ? status.description
              : run.status === "failed"
                ? failureCopy(run.failureCode, locale)
                : status.description}
          </Alert>
        ) : null}

        {showingReadyAfterFailure ? (
          <Alert tone="info" title={copy("managerShowingLastTitle")}>
            {copy("managerShowingLastBody")}
          </Alert>
        ) : null}

        {!run && !error ? <p className="qosp-meta-line">{copy("managerIntro")}</p> : null}

        {result ? (
          <div className="qosp-stack">
            {isReviewOutdated(result, menuVersion) ? (
              <Alert tone="info" title={copy("managerOutdatedTitle")}>
                {copy("managerOutdatedBody", { version: result.menuVersion ?? "" })}
              </Alert>
            ) : null}

            <IntelligenceCard
              kind="Summary"
              kindLabel={intelligenceLabel("managerKindSummary")}
              title={copy("managerReviewTitle")}
              claims={[{ kind: copy("claimAiInterpretation"), text: result.summary }]}
            />

            {result.findings.map((finding, index) => (
              <IntelligenceCard
                key={`finding-${index}`}
                kind="Recommendation"
                kindLabel={intelligenceLabel("managerKindRecommendation")}
                title={
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {finding.title}
                    <Badge tone={SEVERITY_BADGE_TONE[finding.severity]}>
                      {severityLabel(finding.severity, locale)}
                    </Badge>
                  </span>
                }
                claims={markFacts(findingClaims(finding, report, locale))}
              >
                {finding.productPublicIds.length > 0 ? (
                  <ul className="qosp-button-row qosp-plain-list" style={{ marginTop: 8 }}>
                    {finding.productPublicIds.map((productPublicId) => (
                      <li key={productPublicId}>
                        <Link
                          href={productFixHref(
                            tenantId,
                            productPublicId,
                            finding.type === "other" ? "missing_description" : finding.type,
                          )}
                          className="qos-btn"
                          data-variant="secondary"
                          data-size="sm"
                        >
                          {productName(productPublicId)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </IntelligenceCard>
            ))}

            {result.suggestions.map((suggestion, index) => {
              const id = `suggestion-${index}`;
              const key = suggestionIdentityKey(suggestion);
              const applied =
                accepted != null &&
                accepted.runPublicId === (readyRun ?? run)?.publicId &&
                accepted.keys.has(key);
              return (
                <IntelligenceCard
                  key={id}
                  kind="Draft suggestion"
                  kindLabel={intelligenceLabel("managerKindDraftSuggestion")}
                  title={`${productName(suggestion.productPublicId)} · ${suggestionFieldLabel(suggestion.field, locale)}`}
                  claims={[
                    { kind: copy("claimAiRecommendation"), text: suggestion.proposedText },
                    ...(suggestion.rationale
                      ? [{ kind: copy("claimAiInterpretation"), text: suggestion.rationale }]
                      : []),
                  ]}
                  actions={
                    <>
                      <Button
                        variant="intelligence"
                        size="sm"
                        loading={acceptingKey === key}
                        disabled={!acceptEnabled || applied || acceptingKey !== null}
                        onClick={() => void acceptSuggestion(suggestion)}
                      >
                        {applied ? copy("managerAppliedToDraft") : copy("managerAccept")}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void copyText(suggestion.proposedText, id)}>
                        {copied === id ? copy("managerCopied") : copy("managerCopyText")}
                      </Button>
                      <Link
                        href={productFixHref(tenantId, suggestion.productPublicId, "missing_description")}
                        className="qos-btn"
                        data-variant="ghost"
                        data-size="sm"
                      >
                        {copy("managerOpenItem")}
                      </Link>
                    </>
                  }
                />
              );
            })}

            {result.findings.length === 0 && result.suggestions.length === 0 ? (
              <p className="qosp-meta-line">{copy("managerNothingToAdd")}</p>
            ) : null}
          </div>
        ) : null}

        {reviewRun?.status === "completed" && !result ? (
          <Alert tone="warning" title={copy("managerCannotShowTitle")}>
            {copy("managerCannotShowBody")}
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
