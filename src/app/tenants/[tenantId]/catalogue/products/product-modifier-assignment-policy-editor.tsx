"use client";

import { useState } from "react";

import {
  PortalBadge,
  PortalField,
} from "@/components/portal/workspace/PortalWorkspace";
import {
  assignmentHasOverrides,
  countModeLabel,
  describeAssignmentPolicy,
  describeOptionCaps,
  draftFromAssignment,
  policyPatchFromDraft,
  resetPolicyPatch,
  type AssignmentPolicyDraft,
  type AssignmentPolicyPatchBody,
  type AssignmentPolicyView,
} from "@/lib/catalogue/modifier-assignment-policy-ui";
import {
  staffCopyWith,
  staffUiCopy,
  type StaffLocale,
  type StaffUiCopyKey,
} from "@/lib/staff/locale";

type ProductModifierAssignmentPolicyEditorProps = {
  locale: StaffLocale;
  groupPublicId: string;
  assignment: AssignmentPolicyView;
  productVersion: number;
  disabled: boolean;
  onSave: (
    groupPublicId: string,
    body: AssignmentPolicyPatchBody,
    successKey: StaffUiCopyKey,
  ) => Promise<boolean>;
};

/* Product-specific selection and repeat rules for one attached group
   (QOS-212). Shows the effective value, whether it is the group default or a
   product override, and the option limits that result. */
export function ProductModifierAssignmentPolicyEditor({
  locale,
  groupPublicId,
  assignment,
  productVersion,
  disabled,
  onSave,
}: ProductModifierAssignmentPolicyEditorProps) {
  const copy = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [draft, setDraft] = useState<AssignmentPolicyDraft | null>(null);
  const [invalidField, setInvalidField] = useState<"minSelections" | "maxSelections" | null>(null);

  const rows = describeAssignmentPolicy(locale, assignment);
  const caps = describeOptionCaps(locale, assignment);
  const titleId = `modifier-policy-${groupPublicId}`;
  const hasOverrides = assignmentHasOverrides(assignment);

  async function save() {
    if (!draft) return;
    const result = policyPatchFromDraft(draft, assignment, productVersion);
    if (!result.ok) {
      setInvalidField(result.field);
      return;
    }
    setInvalidField(null);
    if (await onSave(groupPublicId, result.body, "modifierPolicySaved")) {
      setDraft(null);
    }
  }

  async function reset() {
    if (await onSave(groupPublicId, resetPolicyPatch(assignment, productVersion), "modifierPolicyResetDone")) {
      setDraft(null);
      setInvalidField(null);
    }
  }

  const boundField = (field: "minSelections" | "maxSelections", labelKey: StaffUiCopyKey, groupValue: number) => (
    <PortalField
      label={copy(labelKey)}
      help={
        invalidField === field
          ? copy("modifierPolicyInvalidNumber")
          : staffCopyWith(locale, "modifierPolicyBlankHelp", { value: groupValue })
      }
    >
      <input
        className="qos-input"
        inputMode="numeric"
        dir="ltr"
        value={draft?.[field] ?? ""}
        placeholder={String(groupValue)}
        aria-invalid={invalidField === field}
        disabled={disabled}
        onChange={(event) =>
          setDraft((current) => (current ? { ...current, [field]: event.target.value } : current))
        }
      />
    </PortalField>
  );

  return (
    <section className="qosp-policy" aria-labelledby={titleId}>
      <h4 id={titleId} className="qosp-policy-title">
        {copy("modifierPolicyTitle")}
      </h4>

      <dl className="qosp-policy-list">
        {rows.map((row) => (
          <div key={row.key} className="qosp-policy-item">
            <dt>{row.label}</dt>
            <dd>
              <span>{row.value}</span>
              <PortalBadge tone={row.source === "overridden" ? "warm" : "neutral"}>{row.sourceLabel}</PortalBadge>
              {row.groupValue ? <span className="qosp-meta-line">{row.groupValue}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {caps.length > 0 ? (
        <p className="qosp-meta-line">
          {copy("modifierPolicyOptionCapsLabel")}:{" "}
          {new Intl.ListFormat(locale, { style: "narrow", type: "unit" }).format(caps)}
        </p>
      ) : null}

      {draft ? (
        <div className="qosp-form-grid" data-columns="2">
          {boundField("minSelections", "modifierPolicyMinimum", assignment.groupMinSelections)}
          {boundField("maxSelections", "modifierPolicyMaximum", assignment.groupMaxSelections)}
          <PortalField label={copy("modifierPolicyRepeats")} help={copy("modifierPolicyRepeatHelp")}>
            <select
              className="qos-select"
              value={draft.repeat}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, repeat: event.target.value as AssignmentPolicyDraft["repeat"] })
              }
            >
              <option value="inherit">
                {copy("modifierPolicyUseGroupDefault")} ({copy("modifierPolicyRepeatsOptionLimits")})
              </option>
              <option value="allow">{copy("modifierPolicyRepeatsAllowed")}</option>
              <option value="deny">{copy("modifierPolicyRepeatsNotAllowed")}</option>
            </select>
          </PortalField>
          <PortalField label={copy("modifierPolicyCounting")}>
            <select
              className="qos-select"
              value={draft.count}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, count: event.target.value as AssignmentPolicyDraft["count"] })
              }
            >
              <option value="inherit">
                {copy("modifierPolicyUseGroupDefault")} ({countModeLabel(locale, "distinct_options")})
              </option>
              <option value="distinct_options">{countModeLabel(locale, "distinct_options")}</option>
              <option value="total_quantity">{countModeLabel(locale, "total_quantity")}</option>
            </select>
          </PortalField>
        </div>
      ) : null}

      <div className="qosp-button-row">
        {draft ? (
          <>
            <button
              type="button"
              className="qos-btn"
              data-variant="primary"
              data-size="sm"
              disabled={disabled}
              onClick={() => void save()}
            >
              {copy("modifierPolicySave")}
            </button>
            <button
              type="button"
              className="qos-btn"
              data-variant="secondary"
              data-size="sm"
              disabled={disabled}
              onClick={() => {
                setDraft(null);
                setInvalidField(null);
              }}
            >
              {copy("cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="qos-btn"
            data-variant="secondary"
            data-size="sm"
            disabled={disabled}
            onClick={() => setDraft(draftFromAssignment(assignment))}
          >
            {copy("modifierPolicyEdit")}
          </button>
        )}
        <button
          type="button"
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
          disabled={disabled || !hasOverrides}
          onClick={() => void reset()}
        >
          {copy("modifierPolicyReset")}
        </button>
      </div>
    </section>
  );
}
