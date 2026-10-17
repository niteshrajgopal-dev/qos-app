export function menuExtractionExtractIdempotencyKey(
  sourcePublicId: string,
  retryNonce?: string,
): string {
  const base = `menu-extraction-extract:${sourcePublicId}`;
  return retryNonce ? `${base}:retry:${retryNonce}` : base;
}
