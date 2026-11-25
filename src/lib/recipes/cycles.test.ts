import { describe, expect, it } from "vitest";

import { buildPreparedEdges, findPreparedCycle, type PreparedFamilyGraphInput } from "@/lib/recipes/cycles";

const TODAY = "2026-11-10";

function family(recipeId: string, outputItemId: string, lineItemIds: string[], overrides: Partial<PreparedFamilyGraphInput["versions"][number]> = {}): PreparedFamilyGraphInput {
  return {
    recipeId,
    outputItemId,
    versions: [{ status: "approved", effectiveTo: null, lines: lineItemIds.map((itemId) => ({ itemId, status: "active" })), ...overrides }],
  };
}

describe("prepared recipe cycle detection", () => {
  it("refuses a line naming the recipe's own output item", () => {
    const edges = buildPreparedEdges([], { recipeId: "r-sauce", outputItemId: "sauce", lineItemIds: ["tomato", "sauce"] }, TODAY);
    expect(findPreparedCycle(edges, "sauce")).toEqual(["sauce", "sauce"]);
  });

  it("refuses a direct cycle A → B → A", () => {
    const edges = buildPreparedEdges([family("r-b", "b", ["a"])], { recipeId: "r-a", outputItemId: "a", lineItemIds: ["b"] }, TODAY);
    expect(findPreparedCycle(edges, "a")).toEqual(["a", "b", "a"]);
  });

  it("refuses an indirect cycle A → B → C → A", () => {
    const edges = buildPreparedEdges(
      [family("r-b", "b", ["flour", "c"]), family("r-c", "c", ["water", "a"])],
      { recipeId: "r-a", outputItemId: "a", lineItemIds: ["sugar", "b"] },
      TODAY,
    );
    expect(findPreparedCycle(edges, "a")).toEqual(["a", "b", "c", "a"]);
  });

  it("accepts a diamond without a cycle", () => {
    const edges = buildPreparedEdges(
      [family("r-b", "b", ["d"]), family("r-c", "c", ["d"]), family("r-d", "d", ["salt"])],
      { recipeId: "r-a", outputItemId: "a", lineItemIds: ["b", "c"] },
      TODAY,
    );
    expect(findPreparedCycle(edges, "a")).toBeNull();
  });

  it("ignores discarded and ended versions but counts open drafts and scheduled versions", () => {
    const discarded = family("r-b", "b", ["a"], { status: "discarded" });
    const ended = family("r-b", "b", ["a"], { effectiveTo: "2026-11-01" });
    const draft = family("r-b", "b", ["a"], { status: "draft" });
    const scheduledEnd = family("r-b", "b", ["a"], { effectiveTo: "2026-12-01" });
    const writing = { recipeId: "r-a", outputItemId: "a", lineItemIds: ["b"] };
    expect(findPreparedCycle(buildPreparedEdges([discarded], writing, TODAY), "a")).toBeNull();
    expect(findPreparedCycle(buildPreparedEdges([ended], writing, TODAY), "a")).toBeNull();
    expect(findPreparedCycle(buildPreparedEdges([draft], writing, TODAY), "a")).toEqual(["a", "b", "a"]);
    expect(findPreparedCycle(buildPreparedEdges([scheduledEnd], writing, TODAY), "a")).toEqual(["a", "b", "a"]);
  });

  it("ignores removed lines and replaces the writing family's stored versions with the lines being saved", () => {
    const removed: PreparedFamilyGraphInput = {
      recipeId: "r-b",
      outputItemId: "b",
      versions: [{ status: "approved", effectiveTo: null, lines: [{ itemId: "a", status: "removed" }] }],
    };
    const self = family("r-a", "a", ["b"]);
    expect(findPreparedCycle(buildPreparedEdges([removed, self], { recipeId: "r-a", outputItemId: "a", lineItemIds: ["b"] }, TODAY), "a")).toBeNull();
    // The writing family's stored self-reference is replaced by the new lines.
    const stale = family("r-a", "a", ["a"]);
    expect(findPreparedCycle(buildPreparedEdges([stale], { recipeId: "r-a", outputItemId: "a", lineItemIds: ["milk"] }, TODAY), "a")).toBeNull();
  });

  it("terminates on a cycle elsewhere in the graph that does not pass through the start", () => {
    const edges = buildPreparedEdges(
      [family("r-b", "b", ["c"]), family("r-c", "c", ["b"])],
      { recipeId: "r-a", outputItemId: "a", lineItemIds: ["b"] },
      TODAY,
    );
    expect(findPreparedCycle(edges, "a")).toBeNull();
  });
});
