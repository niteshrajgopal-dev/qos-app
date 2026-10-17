const ISO_CURRENCY = /\b(AED|USD|EUR|GBP|SAR|QAR|KWD|BHD|OMR)\b/i;
const AMOUNT_TOKEN = /(-?\d+(?:[.,]\d{1,2})?)/;

export type ParsedMenuExtractionPrice = {
  amountMinor: number;
  currency: string;
};

export function parseMenuExtractionPriceText(priceText: string): ParsedMenuExtractionPrice | null {
  const trimmed = priceText.trim();
  if (!trimmed) {
    return null;
  }

  const currencyMatch = trimmed.match(ISO_CURRENCY);
  const currency = currencyMatch ? currencyMatch[1]!.toUpperCase() : "AED";

  const amountMatch = trimmed.match(AMOUNT_TOKEN);
  if (!amountMatch) {
    return null;
  }

  const normalized = amountMatch[1]!.replace(",", ".");
  const major = Number.parseFloat(normalized);
  if (!Number.isFinite(major)) {
    return null;
  }

  const amountMinor = Math.round(major * 100);
  return { amountMinor, currency };
}
