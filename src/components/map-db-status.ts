import type { QosStateKey } from "./qos-states";

export const DB_STATUS_TO_QOS_STATE = {
  tenant_status: {
    active: "active",
    suspended: "suspended",
  },
  location_status: {
    active: "active",
    suspended: "suspended",
  },
  product_status: {
    draft: "draft",
    active: "published",
    archived: "archived",
  },
  storefront_status: {
    draft: "draft",
    active: "live",
    archived: "archived",
  },
  storefront_domain_verification_status: {
    pending: "pending",
    verified: "verified",
    failed: "failed",
  },
  menu_publish_operation_status: {
    completed: "published",
    partial: "partial",
    failed: "failed",
  },
  menu_public_link_status: {
    active: "live",
    paused: "paused",
  },
  access_request_status: {
    pending: "pending",
    approved: "approved",
    rejected: "rejected",
  },
  invitation_status: {
    pending: "pending",
    accepted: "approved",
    revoked: "inactive",
    expired: "inactive",
  },
  provisioning_operation_status: {
    pending: "pending",
    completed: "active",
    failed: "failed",
  },
  translation_approval_status: {
    draft: "draft",
    approved: "approved",
  },
} as const satisfies Record<string, Record<string, QosStateKey>>;

export type DbStatusEnumName = keyof typeof DB_STATUS_TO_QOS_STATE;

export function qosStateFromDb(
  statusEnum: DbStatusEnumName,
  value: string,
): QosStateKey {
  const mapped = DB_STATUS_TO_QOS_STATE[statusEnum] as
    | Record<string, QosStateKey>
    | undefined;
  const key = mapped?.[value];

  if (!key) {
    throw new Error(`No QOS_STATES mapping for ${statusEnum}:${value}`);
  }

  return key;
}
