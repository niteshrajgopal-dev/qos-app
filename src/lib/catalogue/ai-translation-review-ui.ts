export function shouldShowTranslationAcceptedBanner(
  suggestionState: "pending" | "accepted" | "rejected" | "stale" | "failed" | undefined,
  acceptedThisSession: boolean,
): boolean {
  return acceptedThisSession && suggestionState === "accepted";
}
