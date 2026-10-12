/** Menu draft version a stored review answered; only `snapshot.menuVersion` is authoritative. */
export function reviewedMenuVersionFromStoredResult(storedResult: unknown): number | null {
  if (!storedResult || typeof storedResult !== "object") {
    return null;
  }
  const snapshot = (storedResult as { snapshot?: { menuVersion?: unknown } }).snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const menuVersion = snapshot.menuVersion;
  return typeof menuVersion === "number" ? menuVersion : null;
}
