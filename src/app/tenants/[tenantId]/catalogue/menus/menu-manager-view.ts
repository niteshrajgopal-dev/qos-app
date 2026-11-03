import type { MenuManagerWaitReason } from "@/lib/agents/menu-manager/menu-manager-service";
import { reviewedMenuVersionFromStoredResult } from "@/lib/agents/menu-manager/menu-manager-reviewed-version";
import type { AgentRunStatus } from "@/lib/agents/types";
import type { MenuManagerUnavailableReason } from "@/lib/agents/tenant-agent-settings";
import {
  MENU_HEALTH_ISSUE_COPY,
  menuHealthIssueCopy,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-view";
import { menusCopy, menusCount } from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import type { MenuHealthIssueType, MenuHealthReport } from "@/lib/catalogue/menu-health";
import type { StaffLocale } from "@/lib/staff/locale";

const MIN_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 15_000;
const QUEUED_POLL_DELAY_MS = 3_000;

type AlertTone = "info" | "success" | "warning" | "error" | "neutral" | "intelligence";

export type MenuManagerRunLike = {
  publicId: string;
  status: AgentRunStatus;
  result: Record<string, unknown> | null;
  failureCode: string | null;
  /** The run ended before QOS learned whether the agent service finished it. */
  remoteOutcomeUnknown?: boolean;
  waitingOn?: MenuManagerWaitReason | null;
  /** Server-persisted accepts for this run (`product:field:text` keys). */
  acceptedSuggestionKeys?: string[];
  nextPollAt: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type MenuManagerFinding = {
  type: MenuHealthIssueType | "other";
  severity: "info" | "warning" | "blocking";
  title: string;
  detail: string;
  recommendation: string;
  productPublicIds: string[];
};

export type MenuManagerSuggestion = {
  productPublicId: string;
  field: "name_en" | "description_en" | "name_ar" | "description_ar";
  proposedText: string;
  rationale: string;
};

export type MenuManagerResultView = {
  summary: string;
  findings: MenuManagerFinding[];
  suggestions: MenuManagerSuggestion[];
  menuVersion: number | null;
};

export function isActiveRunStatus(status: AgentRunStatus) {
  return status === "queued" || status === "running";
}

/** Ask stays disabled only while a run is still in flight or awaiting unresolved acknowledgement. */
export function isMenuManagerAskDisabled(input: {
  runStatus: AgentRunStatus | null;
  unresolvedRunPublicId: string | null;
}) {
  if (input.unresolvedRunPublicId) {
    return true;
  }
  return input.runStatus !== null && isActiveRunStatus(input.runStatus);
}

/** How long to wait before asking QOS for the run again; null once it has settled. */
export function nextPollDelayMs(run: MenuManagerRunLike, now = Date.now()): number | null {
  if (!isActiveRunStatus(run.status)) {
    return null;
  }
  if (run.waitingOn) {
    return MAX_POLL_DELAY_MS;
  }
  if (!run.nextPollAt) {
    return QUEUED_POLL_DELAY_MS;
  }
  const due = new Date(run.nextPollAt).getTime() - now;
  return Math.min(Math.max(due, MIN_POLL_DELAY_MS), MAX_POLL_DELAY_MS);
}

type StatusCopy = { tone: AlertTone; title: string; description: string };

type ManagerCopy = {
  runStatus: Record<AgentRunStatus, StatusCopy>;
  waiting: Record<MenuManagerWaitReason, StatusCopy>;
  unresolvedByCode: Record<string, StatusCopy>;
  unresolvedFallback: StatusCopy;
  unresolvedRestart: string;
  notStartedTitle: string;
  workerStoppedTitle: string;
  failure: Record<string, string>;
  failureFallback: string;
  fieldLabel: Record<MenuManagerSuggestion["field"], string>;
};

const QOS_STOPPED_WAITING_EN =
  "The review did not finish before QOS's time limit. The agent service may still finish it, but QOS will not use its reply. Nothing on the menu was changed.";
const QOS_STOPPED_WAITING_AR =
  "لم تنتهِ المراجعة قبل انتهاء المهلة المحددة في QOS. قد تُكملها خدمة الوكيل، لكن QOS لن يستخدم ردّها. لم يتغيّر شيء في القائمة.";

const MANAGER_COPY: Record<StaffLocale, ManagerCopy> = {
  en: {
    runStatus: {
      queued: {
        tone: "info",
        title: "Starting review",
        description: "QOS is handing the menu snapshot to the Menu Manager.",
      },
      running: {
        tone: "intelligence",
        title: "Menu Manager is reviewing",
        description: "This usually takes a minute or two. You can keep editing; the review uses the snapshot taken when you asked.",
      },
      awaiting_approval: {
        tone: "warning",
        title: "Review paused",
        description: "The agent stopped to ask for an approval. QOS never approves agent actions, so this review ends here. Ask again to start a fresh review.",
      },
      completed: {
        tone: "success",
        title: "Review ready",
        description: "Suggestions are drafts. Accept writes one field onto the product draft; nothing goes live until you publish the menu.",
      },
      failed: {
        tone: "error",
        title: "Review failed",
        description: "Nothing on the menu was changed.",
      },
    },
    waiting: {
      agent_connection: {
        tone: "warning",
        title: "Review waiting for QOS's agent connection",
        description: "QOS needs to reconnect its agent service. The review continues if the connection returns before its time limit; nothing is sent again.",
      },
      service_unavailable: {
        tone: "warning",
        title: "Review on hold",
        description: "Menu Manager is unavailable right now. QOS stops waiting at the review's time limit; nothing is sent again.",
      },
      access_changed: {
        tone: "warning",
        title: "Review on hold: access changed",
        description: "The business, the agent approval or the requester's access changed, so QOS is not collecting this review. It stops waiting at the time limit; nothing is sent again.",
      },
    },
    unresolvedByCode: {
      qos_wait_deadline: { tone: "warning", title: "QOS stopped waiting", description: QOS_STOPPED_WAITING_EN },
      timeout: { tone: "warning", title: "QOS stopped waiting", description: QOS_STOPPED_WAITING_EN },
      start_outcome_unknown: {
        tone: "warning",
        title: "Could not confirm the review was received",
        description:
          "QOS could not confirm whether the agent service received this review. It may still process it, but QOS will not use its reply. Nothing on the menu was changed.",
      },
      model_submission_unknown: {
        tone: "warning",
        title: "Could not confirm the review was received",
        description:
          "QOS could not confirm whether the model received this review. It may still process it, but QOS will not use its reply. Nothing on the menu was changed.",
      },
      provider_reauth_required: {
        tone: "warning",
        title: "QOS stopped waiting",
        description:
          "QOS lost its agent connection before learning the outcome. The agent service may still finish this review, but QOS will not use its reply. Nothing on the menu was changed.",
      },
    },
    unresolvedFallback: {
      tone: "warning",
      title: "QOS stopped waiting",
      description:
        "The agent service may still finish this review, but QOS will not use its reply. Nothing on the menu was changed.",
    },
    unresolvedRestart:
      "QOS stopped waiting for the previous review, but the agent service may still process it, and it may count toward usage. A new review is sent separately.",
    notStartedTitle: "Review did not start in time",
    workerStoppedTitle: "Review stopped before it finished",
    failure: {
      capability_unavailable: "Menu Manager was turned off before this review was sent.",
      qos_wait_deadline: "The review did not finish within QOS's time limit.",
      timeout: "The review did not finish within QOS's time limit.",
      start_outcome_unknown: "QOS could not confirm whether the agent service received the review.",
      start_not_recorded: "QOS could not confirm that the review started.",
      definition_unavailable: "QOS was updated before this review was sent, so it was not sent. Ask again.",
      pinned_input_invalid: "QOS could not verify the menu data for this review, so it was not sent.",
      executor_mismatch: "QOS's agent service changed before this review was sent, so it was not sent. Ask again.",
      tenant_inactive: "This business is not active, so the review was not sent.",
      binding_changed: "Menu Manager's approval changed before this review was sent, so it was not sent.",
      requester_access_revoked: "Your access changed before this review was sent, so it was not sent.",
      subject_unavailable: "This menu is no longer available, so the review was not sent.",
      provider_reauth_required: "QOS needs to reconnect its agent service. Try again later.",
      provider_not_connected: "QOS's agent service is not connected right now.",
      invalid_result_json: "The agent's reply could not be read, so QOS discarded it.",
      invalid_result_shape: "The agent's reply did not match what QOS accepts, so it was discarded.",
      result_menu_mismatch: "The agent answered about a different menu, so the reply was discarded.",
      unknown_product_reference: "The agent referred to items that are not on this menu, so the reply was discarded.",
      empty_final_message: "The agent finished without a reply.",
      final_message_too_large: "The agent's reply was too large to accept.",
      model_submission_unknown:
        "QOS could not confirm whether the model received this review. Nothing on the menu was changed.",
      too_many_tool_rounds: "The review needed more tool calls than QOS allows, so it was stopped.",
      not_started_in_time: "QOS did not start this review in time. Nothing was sent to the agent service.",
      worker_stopped_mid_review:
        "The AI worker stopped before this review finished. Nothing on the menu was changed. You can ask again.",
      worker_native_model_unavailable:
        "The AI worker is not configured to run Menu Manager reviews. An administrator must align the worker environment with the API.",
    },
    failureFallback: "The agent service could not complete this review.",
    fieldLabel: {
      name_en: "English name",
      description_en: "English description",
      name_ar: "Arabic name",
      description_ar: "Arabic description",
    },
  },
  ar: {
    runStatus: {
      queued: {
        tone: "info",
        title: "بدء المراجعة",
        description: "يسلّم QOS نسخة القائمة إلى مدير القائمة.",
      },
      running: {
        tone: "intelligence",
        title: "مدير القائمة يراجع الآن",
        description: "يستغرق ذلك عادةً دقيقة أو دقيقتين. يمكنك متابعة التعديل؛ فالمراجعة تعتمد على النسخة المأخوذة عند طلبك.",
      },
      awaiting_approval: {
        tone: "warning",
        title: "توقفت المراجعة مؤقتًا",
        description: "توقف الوكيل ليطلب موافقة. لا يوافق QOS أبدًا على إجراءات الوكيل، لذا تنتهي هذه المراجعة هنا. اطلب مراجعة أخرى لبدء مراجعة جديدة.",
      },
      completed: {
        tone: "success",
        title: "المراجعة جاهزة",
        description: "الاقتراحات مسودات. يكتب القبول حقلًا واحدًا في مسودة المنتج، ولا يُنشر شيء حتى تنشر القائمة.",
      },
      failed: {
        tone: "error",
        title: "فشلت المراجعة",
        description: "لم يتغيّر شيء في القائمة.",
      },
    },
    waiting: {
      agent_connection: {
        tone: "warning",
        title: "المراجعة بانتظار اتصال وكيل QOS",
        description: "يحتاج QOS إلى إعادة الاتصال بخدمة الوكيل. تستمر المراجعة إذا عاد الاتصال قبل انتهاء مهلتها، ولن يُرسل أي شيء مجددًا.",
      },
      service_unavailable: {
        tone: "warning",
        title: "المراجعة معلّقة",
        description: "مدير القائمة غير متاح حاليًا. يتوقف QOS عن الانتظار عند انتهاء مهلة المراجعة، ولن يُرسل أي شيء مجددًا.",
      },
      access_changed: {
        tone: "warning",
        title: "المراجعة معلّقة: تغيّرت الصلاحيات",
        description: "تغيّر النشاط أو موافقة الوكيل أو صلاحيات مقدّم الطلب، لذا لا يستلم QOS هذه المراجعة. يتوقف عن الانتظار عند انتهاء المهلة، ولن يُرسل أي شيء مجددًا.",
      },
    },
    unresolvedByCode: {
      qos_wait_deadline: { tone: "warning", title: "توقف QOS عن الانتظار", description: QOS_STOPPED_WAITING_AR },
      timeout: { tone: "warning", title: "توقف QOS عن الانتظار", description: QOS_STOPPED_WAITING_AR },
      start_outcome_unknown: {
        tone: "warning",
        title: "تعذّر تأكيد استلام المراجعة",
        description:
          "تعذّر على QOS تأكيد ما إذا كانت خدمة الوكيل قد استلمت هذه المراجعة. قد تعالجها، لكن QOS لن يستخدم ردّها. لم يتغيّر شيء في القائمة.",
      },
      model_submission_unknown: {
        tone: "warning",
        title: "تعذّر تأكيد استلام المراجعة",
        description:
          "تعذّر على QOS تأكيد ما إذا كان النموذج قد استلم هذه المراجعة. قد يعالجها، لكن QOS لن يستخدم ردّه. لم يتغيّر شيء في القائمة.",
      },
      provider_reauth_required: {
        tone: "warning",
        title: "توقف QOS عن الانتظار",
        description:
          "فقد QOS اتصاله بخدمة الوكيل قبل معرفة النتيجة. قد تُكمل خدمة الوكيل هذه المراجعة، لكن QOS لن يستخدم ردّها. لم يتغيّر شيء في القائمة.",
      },
    },
    unresolvedFallback: {
      tone: "warning",
      title: "توقف QOS عن الانتظار",
      description: "قد تُكمل خدمة الوكيل هذه المراجعة، لكن QOS لن يستخدم ردّها. لم يتغيّر شيء في القائمة.",
    },
    unresolvedRestart:
      "توقف QOS عن انتظار المراجعة السابقة، لكن قد تستمر خدمة الوكيل في معالجتها وقد تُحتسب ضمن الاستخدام. تُرسل المراجعة الجديدة بشكل منفصل.",
    notStartedTitle: "لم تبدأ المراجعة في الوقت المحدد",
    workerStoppedTitle: "توقفت المراجعة قبل اكتمالها",
    failure: {
      capability_unavailable: "أُوقف مدير القائمة قبل إرسال هذه المراجعة.",
      qos_wait_deadline: "لم تنتهِ المراجعة ضمن المهلة المحددة في QOS.",
      timeout: "لم تنتهِ المراجعة ضمن المهلة المحددة في QOS.",
      start_outcome_unknown: "تعذّر على QOS تأكيد ما إذا كانت خدمة الوكيل قد استلمت المراجعة.",
      start_not_recorded: "تعذّر على QOS تأكيد بدء المراجعة.",
      definition_unavailable: "حُدِّث QOS قبل إرسال هذه المراجعة، لذا لم تُرسل. اطلبها مجددًا.",
      pinned_input_invalid: "تعذّر على QOS التحقق من بيانات القائمة لهذه المراجعة، لذا لم تُرسل.",
      executor_mismatch: "تغيّرت خدمة وكيل QOS قبل إرسال هذه المراجعة، لذا لم تُرسل. اطلبها مجددًا.",
      tenant_inactive: "هذا النشاط غير مفعّل، لذا لم تُرسل المراجعة.",
      binding_changed: "تغيّرت موافقة مدير القائمة قبل إرسال هذه المراجعة، لذا لم تُرسل.",
      requester_access_revoked: "تغيّرت صلاحياتك قبل إرسال هذه المراجعة، لذا لم تُرسل.",
      subject_unavailable: "لم تعد هذه القائمة متاحة، لذا لم تُرسل المراجعة.",
      provider_reauth_required: "يحتاج QOS إلى إعادة الاتصال بخدمة الوكيل. حاول لاحقًا.",
      provider_not_connected: "خدمة وكيل QOS غير متصلة حاليًا.",
      invalid_result_json: "تعذّرت قراءة ردّ الوكيل، لذا تجاهله QOS.",
      invalid_result_shape: "لم يطابق ردّ الوكيل ما يقبله QOS، لذا تم تجاهله.",
      result_menu_mismatch: "أجاب الوكيل عن قائمة مختلفة، لذا تم تجاهل الرد.",
      unknown_product_reference: "أشار الوكيل إلى أصناف ليست في هذه القائمة، لذا تم تجاهل الرد.",
      empty_final_message: "أنهى الوكيل عمله دون رد.",
      final_message_too_large: "ردّ الوكيل أكبر من الحد المقبول.",
      model_submission_unknown:
        "تعذّر على QOS تأكيد ما إذا كان النموذج قد استلم هذه المراجعة. لم يتغيّر شيء في القائمة.",
      too_many_tool_rounds: "احتاجت المراجعة إلى استدعاءات أدوات أكثر مما يسمح به QOS، لذا أُوقفت.",
      not_started_in_time: "لم يبدأ QOS هذه المراجعة في الوقت المحدد. لم يُرسل شيء إلى خدمة الوكيل.",
      worker_stopped_mid_review:
        "توقف عامل الذكاء الاصطناعي قبل انتهاء هذه المراجعة. لم يتغيّر شيء في القائمة. يمكنك طلبها مجددًا.",
      worker_native_model_unavailable:
        "عامل الذكاء الاصطناعي غير مُعدّ لتشغيل مراجعات مدير القائمة. يجب على المسؤول مواءمة بيئة العامل مع الواجهة البرمجية.",
    },
    failureFallback: "تعذّر على خدمة الوكيل إكمال هذه المراجعة.",
    fieldLabel: {
      name_en: "الاسم بالإنجليزية",
      description_en: "الوصف بالإنجليزية",
      name_ar: "الاسم بالعربية",
      description_ar: "الوصف بالعربية",
    },
  },
};

export const RUN_STATUS_COPY = MANAGER_COPY.en.runStatus;

export const UNRESOLVED_RESTART_COPY = MANAGER_COPY.en.unresolvedRestart;

export function unresolvedRestartCopy(locale: StaffLocale = "en") {
  return MANAGER_COPY[locale].unresolvedRestart;
}

/** Status copy that never presents QOS stopping as the agent service failing. */
export function runStatusCopy(run: MenuManagerRunLike, locale: StaffLocale = "en") {
  const copy = MANAGER_COPY[locale];
  if (run.status === "failed" && run.remoteOutcomeUnknown) {
    const code = run.failureCode ?? "";
    return copy.unresolvedByCode[code] ?? copy.unresolvedFallback;
  }
  if (run.status === "failed" && run.failureCode === "not_started_in_time") {
    return {
      tone: "error" as const,
      title: copy.notStartedTitle,
      description: copy.failure.not_started_in_time,
    };
  }
  if (run.status === "failed" && run.failureCode === "worker_stopped_mid_review") {
    return {
      tone: "error" as const,
      title: copy.workerStoppedTitle,
      description: copy.failure.worker_stopped_mid_review,
    };
  }
  if (isActiveRunStatus(run.status) && run.waitingOn) {
    return copy.waiting[run.waitingOn];
  }
  return copy.runStatus[run.status];
}

export function failureCopy(code: string | null, locale: StaffLocale = "en") {
  const copy = MANAGER_COPY[locale];
  return (code && copy.failure[code]) || copy.failureFallback;
}

/** Unavailable-state hint, only for people who can do something about it. */
export function unavailableHint(
  reason: MenuManagerUnavailableReason | null,
  canManage: boolean,
  locale: StaffLocale = "en",
) {
  if (!canManage) {
    return null;
  }
  if (reason === "disabled") {
    return menusCopy(locale, "managerDisabledHint");
  }
  return null;
}

export function askButtonLabel(selectedCount: number, locale: StaffLocale = "en") {
  return selectedCount > 0
    ? menusCount(locale, "askAboutSelected", selectedCount)
    : menusCopy(locale, "managerAskWholeMenu");
}

export const SUGGESTION_FIELD_LABEL = MANAGER_COPY.en.fieldLabel;

export function suggestionFieldLabel(field: MenuManagerSuggestion["field"], locale: StaffLocale = "en") {
  return MANAGER_COPY[locale].fieldLabel[field];
}

const FINDING_TYPES = new Set<string>([...Object.keys(MENU_HEALTH_ISSUE_COPY), "other"]);
const SEVERITIES = new Set(["info", "warning", "blocking"]);
const FIELDS = new Set(Object.keys(SUGGESTION_FIELD_LABEL));

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Narrows a stored run result for display. The server already validated it;
 * this only protects the UI from rendering anything unexpected.
 */
export function readMenuManagerResult(result: unknown): MenuManagerResultView | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const value = result as Record<string, unknown>;
  if (!isString(value.summary) || !Array.isArray(value.findings) || !Array.isArray(value.suggestions)) {
    return null;
  }

  const findings = value.findings.filter(
    (entry): entry is MenuManagerFinding =>
      !!entry &&
      typeof entry === "object" &&
      FINDING_TYPES.has((entry as MenuManagerFinding).type) &&
      SEVERITIES.has((entry as MenuManagerFinding).severity) &&
      isString((entry as MenuManagerFinding).title) &&
      isString((entry as MenuManagerFinding).detail) &&
      isString((entry as MenuManagerFinding).recommendation) &&
      Array.isArray((entry as MenuManagerFinding).productPublicIds) &&
      (entry as MenuManagerFinding).productPublicIds.every(isString),
  );
  const suggestions = value.suggestions.filter(
    (entry): entry is MenuManagerSuggestion =>
      !!entry &&
      typeof entry === "object" &&
      isString((entry as MenuManagerSuggestion).productPublicId) &&
      FIELDS.has((entry as MenuManagerSuggestion).field) &&
      isString((entry as MenuManagerSuggestion).proposedText) &&
      isString((entry as MenuManagerSuggestion).rationale),
  );
  return {
    summary: value.summary,
    findings,
    suggestions,
    menuVersion: reviewedMenuVersionFromStoredResult(value),
  };
}

/**
 * Claims for one finding, keeping QOS's own checks visibly separate from the
 * agent's interpretation and recommendation.
 */
export function findingClaims(
  finding: MenuManagerFinding,
  report: MenuHealthReport | null,
  locale: StaffLocale = "en",
) {
  const claims: Array<{ kind: string; text: string }> = [];
  if (report && finding.type !== "other") {
    const group = report.issueGroups.find((entry) => entry.type === finding.type);
    if (group) {
      claims.push({
        kind: menusCopy(locale, "claimSystemFact"),
        text: menusCount(locale, "qosChecksItems", group.productCount, {
          title: menuHealthIssueCopy(finding.type, locale).title,
        }),
      });
    }
  }
  if (finding.detail) {
    claims.push({ kind: menusCopy(locale, "claimAiInterpretation"), text: finding.detail });
  }
  if (finding.recommendation) {
    claims.push({ kind: menusCopy(locale, "claimAiRecommendation"), text: finding.recommendation });
  }
  return claims;
}

export function productNameLookup(report: MenuHealthReport | null) {
  const names = new Map(
    (report?.products ?? []).map((product) => [product.productPublicId, product.displayName]),
  );
  return (productPublicId: string) => names.get(productPublicId) ?? productPublicId;
}

/** True when the draft was saved again after the snapshot the review used. */
export function isReviewOutdated(result: MenuManagerResultView, currentMenuVersion: number) {
  return result.menuVersion !== null && result.menuVersion !== currentMenuVersion;
}

/** Accept is only offered when the review is known to match the current menu draft. */
export function canAcceptSuggestions(result: MenuManagerResultView, currentMenuVersion: number) {
  return result.menuVersion === currentMenuVersion;
}

export function suggestionIdentityKey(suggestion: MenuManagerSuggestion) {
  return `${suggestion.productPublicId}:${suggestion.field}:${suggestion.proposedText}`;
}

export function newIdempotencyKey() {
  return `menu-review-${crypto.randomUUID()}`;
}
