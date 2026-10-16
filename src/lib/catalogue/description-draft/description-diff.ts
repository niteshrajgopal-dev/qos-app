export type DescriptionDiffLine = {
  kind: "unchanged" | "removed" | "added";
  text: string;
};

/** Simple line-based diff for staff review (not a full Myers diff). */
export function diffDescriptionLines(
  before: string | null,
  after: string | null,
): DescriptionDiffLine[] {
  const left = (before ?? "").split(/\r?\n/);
  const right = (after ?? "").split(/\r?\n/);
  const max = Math.max(left.length, right.length);
  const lines: DescriptionDiffLine[] = [];

  for (let index = 0; index < max; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      if (a !== undefined) {
        lines.push({ kind: "unchanged", text: a });
      }
      continue;
    }
    if (a !== undefined) {
      lines.push({ kind: "removed", text: a });
    }
    if (b !== undefined) {
      lines.push({ kind: "added", text: b });
    }
  }

  if (lines.length === 0 && before === null && after === null) {
    return [];
  }
  if (lines.length === 0) {
    return [{ kind: "unchanged", text: "" }];
  }
  return lines;
}
