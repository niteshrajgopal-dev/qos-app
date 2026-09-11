import { afterEach, describe, expect, it } from "vitest";

import {
  OperatorAuthorizationError,
  rejectTenantSelfServiceProvisioning,
  requireOperatorIdentity,
} from "@/lib/platform/operator-auth";

describe("operator auth", () => {
  afterEach(() => {
    delete process.env.PLATFORM_OPERATOR_API_KEY;
  });

  it("accepts a valid operator key and subject", () => {
    process.env.PLATFORM_OPERATOR_API_KEY = "test-operator-key";
    const headers = new Headers({
      "x-qos-operator-key": "test-operator-key",
      "x-qos-operator-subject": "operator@qosapp.com",
    });

    expect(requireOperatorIdentity(headers)).toEqual({
      subject: "operator@qosapp.com",
    });
  });

  it("rejects missing operator credentials", () => {
    process.env.PLATFORM_OPERATOR_API_KEY = "test-operator-key";
    const headers = new Headers();

    expect(() => requireOperatorIdentity(headers)).toThrow(
      OperatorAuthorizationError,
    );
  });

  it("rejects tenant staff self-service provisioning headers", () => {
    const headers = new Headers({
      "x-qos-tenant-staff-role": "user",
    });

    expect(() => rejectTenantSelfServiceProvisioning(headers)).toThrow(
      /Tenant staff cannot provision businesses/,
    );
  });
});
