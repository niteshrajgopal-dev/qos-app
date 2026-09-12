import { describe, expect, it } from "vitest";

import {
  accessRequestStatusEnum,
  invitationStatusEnum,
  locationStatusEnum,
  menuPublicLinkStatusEnum,
  menuPublishOperationStatusEnum,
  productStatusEnum,
  provisioningOperationStatusEnum,
  storefrontDomainVerificationStatusEnum,
  storefrontStatusEnum,
  tenantStatusEnum,
  translationApprovalStatusEnum,
} from "@/db/schema";

import { qosStateFromDb } from "./map-db-status";
import { QOS_STATES, type QosStateKey } from "./qos-states";

const SCHEMA_STATUS_ENUMS = {
  tenant_status: tenantStatusEnum,
  location_status: locationStatusEnum,
  product_status: productStatusEnum,
  storefront_status: storefrontStatusEnum,
  storefront_domain_verification_status: storefrontDomainVerificationStatusEnum,
  menu_publish_operation_status: menuPublishOperationStatusEnum,
  menu_public_link_status: menuPublicLinkStatusEnum,
  access_request_status: accessRequestStatusEnum,
  invitation_status: invitationStatusEnum,
  provisioning_operation_status: provisioningOperationStatusEnum,
  translation_approval_status: translationApprovalStatusEnum,
} as const;

describe("qosStateFromDb", () => {
  it("maps every listed schema status value onto a QOS_STATES key", () => {
    for (const [enumName, statusEnum] of Object.entries(SCHEMA_STATUS_ENUMS)) {
      for (const value of statusEnum.enumValues) {
        const key = qosStateFromDb(
          enumName as keyof typeof SCHEMA_STATUS_ENUMS,
          value,
        );

        expect(QOS_STATES[key], `${enumName}.${value}`).toBeDefined();
      }
    }
  });

  it("maps product active to published so screens never show the raw enum", () => {
    expect(qosStateFromDb("product_status", "active")).toBe("published");
    expect(qosStateFromDb("product_status", "draft")).toBe("draft");
    expect(qosStateFromDb("product_status", "archived")).toBe("archived");
  });

  it("maps a live storefront and public menu link to live", () => {
    expect(qosStateFromDb("storefront_status", "active")).toBe("live");
    expect(qosStateFromDb("menu_public_link_status", "active")).toBe("live");
    expect(qosStateFromDb("menu_public_link_status", "paused")).toBe("paused");
  });

  it("maps invitation and access-request outcomes onto existing state words", () => {
    expect(qosStateFromDb("invitation_status", "accepted")).toBe("approved");
    expect(qosStateFromDb("invitation_status", "revoked")).toBe("inactive");
    expect(qosStateFromDb("invitation_status", "expired")).toBe("inactive");
    expect(qosStateFromDb("access_request_status", "rejected")).toBe("rejected");
  });

  it("maps operation completion without inventing a new state word", () => {
    expect(qosStateFromDb("provisioning_operation_status", "completed")).toBe(
      "active",
    );
    expect(qosStateFromDb("menu_publish_operation_status", "completed")).toBe(
      "published",
    );
    expect(qosStateFromDb("menu_publish_operation_status", "partial")).toBe(
      "partial",
    );
  });

  it("throws when a schema value has no mapping", () => {
    expect(() => qosStateFromDb("tenant_status", "unknown")).toThrow(
      /tenant_status:unknown/,
    );
  });

  it("returns only keys that exist on QOS_STATES", () => {
    const key: QosStateKey = qosStateFromDb("tenant_status", "suspended");
    expect(key).toBe("suspended");
  });
});
