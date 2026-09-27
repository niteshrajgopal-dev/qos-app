import type { StaffLocale, StaffUiCopyKey } from "@/lib/staff/locale";
import { staffUiCopy } from "@/lib/staff/locale";

type VideoErrorKey = Extract<
  StaffUiCopyKey,
  | "videoErrorEmpty"
  | "videoErrorTooLarge"
  | "videoErrorTooLong"
  | "videoErrorResolution"
  | "videoErrorUnsupportedContainer"
  | "videoErrorUnsupportedCodec"
  | "videoErrorContentType"
  | "videoErrorProbe"
  | "videoErrorTranscode"
  | "videoErrorPoster"
  | "videoErrorQuarantined"
  | "videoErrorGeneric"
>;

export function mapVideoErrorToFriendlyMessage(
  errorMessage: string | null | undefined,
  locale: StaffLocale,
): string {
  if (!errorMessage) {
    return staffUiCopy(locale, "videoErrorGeneric");
  }

  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes("empty")) {
    return staffUiCopy(locale, "videoErrorEmpty");
  }

  if (
    lowerMessage.includes("exceeds the owner-locked byte limit") ||
    lowerMessage.includes("size must be between")
  ) {
    return staffUiCopy(locale, "videoErrorTooLarge");
  }

  if (
    lowerMessage.includes("duration") &&
    (lowerMessage.includes("exceeds") || lowerMessage.includes("limit"))
  ) {
    return staffUiCopy(locale, "videoErrorTooLong");
  }

  if (
    lowerMessage.includes("resolution") &&
    (lowerMessage.includes("exceeds") || lowerMessage.includes("limit"))
  ) {
    return staffUiCopy(locale, "videoErrorResolution");
  }

  if (
    lowerMessage.includes("container format") &&
    lowerMessage.includes("not allowed")
  ) {
    return staffUiCopy(locale, "videoErrorUnsupportedContainer");
  }

  if (
    lowerMessage.includes("codec") &&
    lowerMessage.includes("not allowed")
  ) {
    return staffUiCopy(locale, "videoErrorUnsupportedCodec");
  }

  if (
    lowerMessage.includes("do not match the declared") &&
    lowerMessage.includes("content type")
  ) {
    return staffUiCopy(locale, "videoErrorContentType");
  }

  if (lowerMessage.includes("only mp4")) {
    return staffUiCopy(locale, "videoErrorContentType");
  }

  if (
    lowerMessage.includes("failed to probe") ||
    lowerMessage.includes("failed to parse ffprobe")
  ) {
    return staffUiCopy(locale, "videoErrorProbe");
  }

  if (lowerMessage.includes("failed to transcode")) {
    return staffUiCopy(locale, "videoErrorTranscode");
  }

  if (lowerMessage.includes("failed to extract poster")) {
    return staffUiCopy(locale, "videoErrorPoster");
  }

  if (lowerMessage.includes("quarantined")) {
    return staffUiCopy(locale, "videoErrorQuarantined");
  }

  return staffUiCopy(locale, "videoErrorGeneric");
}
