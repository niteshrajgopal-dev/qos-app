const AUDIT_ACTION_LABELS: Record<string, string> = {
  "catalogue.menu_extraction.cancelled": "Catalogue menu extraction cancelled",
  "catalogue.menu_extraction.rejected": "Catalogue menu extraction cancelled",
};

export function tenantAuditActionLabel(action: string): string {
  const explicit = AUDIT_ACTION_LABELS[action];
  if (explicit) {
    return explicit;
  }

  return action
    .replace(/[._]/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}
