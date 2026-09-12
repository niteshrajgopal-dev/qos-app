import { describe, expect, it } from "vitest";

import { QOS_STATES, resolveQosState } from "./qos-states";

describe("QOS_STATES", () => {
  it("is the canonical vocabulary for wording, tone, and icon", () => {
    expect(QOS_STATES.live).toEqual({
      tone: "success",
      icon: "radio",
      label: "Live",
    });
    expect(QOS_STATES.out_of_sync).toEqual({
      tone: "warning",
      icon: "refresh-cw-off",
      label: "Out of sync",
    });
    expect(QOS_STATES.draft.label).toBe("Draft");
    expect(QOS_STATES.published.label).toBe("Published");
    expect(QOS_STATES.connected.label).toBe("Connected");
    expect(QOS_STATES.pending.label).toBe("Pending");
    expect(QOS_STATES.failed.tone).toBe("error");
    expect(QOS_STATES.syncing.tone).toBe("processing");
  });

  it("covers every state used by StatusBadge in the design references", () => {
    const required = [
      "live",
      "active",
      "published",
      "connected",
      "synced",
      "healthy",
      "verified",
      "approved",
      "draft",
      "unpublished",
      "archived",
      "disconnected",
      "available",
      "inactive",
      "paused",
      "warning",
      "out_of_sync",
      "config_required",
      "unsaved",
      "suspended",
      "pending",
      "partial",
      "error",
      "failed",
      "rejected",
      "offline",
      "processing",
      "syncing",
      "provisioning",
      "publishing",
      "preview",
      "info",
    ] as const;

    for (const key of required) {
      expect(QOS_STATES[key], key).toMatchObject({
        tone: expect.any(String),
        icon: expect.any(String),
        label: expect.any(String),
      });
    }
  });
});

describe("resolveQosState", () => {
  it("returns the canonical config for a known state", () => {
    expect(resolveQosState("published")).toEqual(QOS_STATES.published);
  });

  it("falls back to info when the state is unknown", () => {
    expect(resolveQosState("not_a_real_state")).toEqual(QOS_STATES.info);
  });
});
