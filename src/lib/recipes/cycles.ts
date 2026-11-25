import { isOpenOn } from "@/lib/recipes/dates";

/* QOS-198 prepared-recipe cycle detection. Pure.

   Nodes are inventory items. A prepared family whose output is item A adds an
   edge A → B for every active line item B of its open draft and of its
   approved versions that have not ended. Discarded versions and ended
   versions add nothing. The family being written contributes only the lines
   being saved (or approved), so the check answers "would these lines close a
   loop back to this output item?". A line naming the output item itself is a
   cycle of length one. */

export type PreparedFamilyGraphInput = {
  recipeId: string;
  outputItemId: string;
  versions: ReadonlyArray<{
    status: "draft" | "approved" | "discarded";
    effectiveTo: string | null;
    lines: ReadonlyArray<{ itemId: string; status: "active" | "removed" }>;
  }>;
};

export type PreparedEdges = ReadonlyMap<string, ReadonlySet<string>>;

export function buildPreparedEdges(
  families: readonly PreparedFamilyGraphInput[],
  writing: { recipeId: string; outputItemId: string; lineItemIds: readonly string[] },
  today: string,
): PreparedEdges {
  const edges = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    const targets = edges.get(from) ?? new Set<string>();
    targets.add(to);
    edges.set(from, targets);
  };
  for (const family of families) {
    if (family.recipeId === writing.recipeId) continue;
    for (const version of family.versions) {
      const counts =
        version.status === "draft" || (version.status === "approved" && isOpenOn(version.effectiveTo, today));
      if (!counts) continue;
      for (const line of version.lines) {
        if (line.status === "active") add(family.outputItemId, line.itemId);
      }
    }
  }
  for (const itemId of writing.lineItemIds) {
    add(writing.outputItemId, itemId);
  }
  return edges;
}

/**
 * Depth-first search from `startItemId`. Returns the item ids of a path that
 * leads back to the start (first and last element are the start), or null
 * when no cycle passes through it.
 */
export function findPreparedCycle(edges: PreparedEdges, startItemId: string): string[] | null {
  const visited = new Set<string>();
  const path: string[] = [startItemId];

  const visit = (node: string): string[] | null => {
    for (const next of edges.get(node) ?? []) {
      if (next === startItemId) {
        return [...path, startItemId];
      }
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const found = visit(next);
      if (found) return found;
      path.pop();
    }
    return null;
  };

  return visit(startItemId);
}
