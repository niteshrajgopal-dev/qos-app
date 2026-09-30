"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  productFixHref,
  SEVERITY_BADGE_TONE,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-view";
import {
  askButtonLabel,
  failureCopy,
  findingClaims,
  isActiveRunStatus,
  isReviewOutdated,
  newIdempotencyKey,
  nextPollDelayMs,
  productNameLookup,
  readMenuManagerResult,
  RUN_STATUS_COPY,
  SUGGESTION_FIELD_LABEL,
  type MenuManagerRunLike,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-view";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { IntelligenceCard } from "@/design-system/components/intelligence/IntelligenceCard";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

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
  error?: string;
  code?: string;
  activeRunPublicId?: string;
};

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
  const [run, setRun] = useState<MenuManagerRunLike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** Kept until QOS answers, so a retried request after a network drop replays instead of duplicating. */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  const runsPath = `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/agent-runs`;

  const loadRun = useCallback(
    async (runPublicId: string) => {
      const response = await staffApiFetch(`${runsPath}/${runPublicId}`);
      const payload = await readPayload(response);
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "Unable to load the review.");
      }
      setRun(payload.run);
      setError(null);
    },
    [runsPath],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await staffApiFetch(runsPath);
        const payload = await readPayload(response);
        if (!cancelled && response.ok) {
          setRun(payload.run ?? null);
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
        setError(pollError instanceof Error ? pollError.message : "Unable to load the review.");
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [loadRun, run, visible]);

  async function ask() {
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
        }),
      });
      const payload = await readPayload(response);
      setPendingKey(null);

      if (response.ok && payload.run) {
        setRun(payload.run);
        onClearSelection();
        return;
      }
      if (payload.code === "run_in_progress" && payload.activeRunPublicId) {
        await loadRun(payload.activeRunPublicId);
        return;
      }
      setError(payload.error ?? "Unable to start the review.");
    } catch {
      setError("QOS could not be reached. Try again; the same request will be reused.");
    } finally {
      setAsking(false);
    }
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  }

  const active = run ? isActiveRunStatus(run.status) : false;
  const status = run ? RUN_STATUS_COPY[run.status] : null;
  const result = run?.status === "completed" ? readMenuManagerResult(run.result) : null;
  const productName = productNameLookup(report);
  const selectedCount = selectedProductPublicIds.length;

  return (
    <Card
      header="Menu Manager"
      subtitle="AI review of the saved draft. QOS sends a snapshot of this menu and changes nothing automatically."
      actions={
        <Button
          variant="intelligence"
          size="sm"
          icon="sparkles"
          loading={asking}
          disabled={active}
          onClick={() => void ask()}
        >
          {run && !active ? (selectedCount > 0 ? askButtonLabel(selectedCount) : "Ask again") : askButtonLabel(selectedCount)}
        </Button>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        {selectedCount > 0 ? (
          <p className="qos-card-sub">
            {selectedCount} {selectedCount === 1 ? "item" : "items"} selected from menu health.{" "}
            <button type="button" className="qos-btn" data-variant="ghost" data-size="sm" onClick={onClearSelection}>
              Clear selection
            </button>
          </p>
        ) : null}

        {error ? (
          <Alert tone="error" title="Menu Manager">
            {error}
          </Alert>
        ) : null}

        {run && status ? (
          <Alert tone={status.tone} title={status.title}>
            {run.status === "failed" ? `${failureCopy(run.failureCode)} ${status.description}` : status.description}
          </Alert>
        ) : null}

        {!run && !error ? (
          <p className="qos-card-sub">
            Ask QOS for a second opinion on missing photos, descriptions, translations, pricing,
            categories, modifiers, availability and duplicates.
          </p>
        ) : null}

        {result ? (
          <div style={{ display: "grid", gap: 12 }}>
            {isReviewOutdated(result, menuVersion) ? (
              <Alert tone="info" title="The draft changed since this review">
                This review used draft v{result.menuVersion}. Ask again to review the latest save.
              </Alert>
            ) : null}

            <IntelligenceCard
              kind="Summary"
              title="Menu Manager review"
              claims={[{ kind: "AI interpretation", text: result.summary }]}
            />

            {result.findings.map((finding, index) => (
              <IntelligenceCard
                key={`finding-${index}`}
                kind="Recommendation"
                title={
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {finding.title}
                    <Badge tone={SEVERITY_BADGE_TONE[finding.severity]}>
                      {finding.severity}
                    </Badge>
                  </span>
                }
                claims={findingClaims(finding, report)}
              >
                {finding.productPublicIds.length > 0 ? (
                  <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0, margin: "8px 0 0" }}>
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
              return (
                <IntelligenceCard
                  key={id}
                  kind="Draft suggestion"
                  title={`${productName(suggestion.productPublicId)} · ${SUGGESTION_FIELD_LABEL[suggestion.field]}`}
                  claims={[
                    { kind: "AI recommendation", text: suggestion.proposedText },
                    ...(suggestion.rationale ? [{ kind: "AI interpretation", text: suggestion.rationale }] : []),
                  ]}
                  actions={
                    <>
                      <Button variant="secondary" size="sm" onClick={() => void copy(suggestion.proposedText, id)}>
                        {copied === id ? "Copied" : "Copy text"}
                      </Button>
                      <Link
                        href={productFixHref(tenantId, suggestion.productPublicId, "missing_description")}
                        className="qos-btn"
                        data-variant="ghost"
                        data-size="sm"
                      >
                        Open item
                      </Link>
                    </>
                  }
                />
              );
            })}

            {result.findings.length === 0 && result.suggestions.length === 0 ? (
              <p className="qos-card-sub">The Menu Manager found nothing to add.</p>
            ) : null}
          </div>
        ) : null}

        {run?.status === "completed" && !result ? (
          <Alert tone="warning" title="Review could not be shown">
            The stored review is not in a format this screen can display.
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
