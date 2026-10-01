import { createHash } from "node:crypto";

export const AI_PHOTO_PROMPT_VERSION = "qos.ai_photo_prompt.v1";

export type AiPhotoProductContext = {
  displayName: string;
  description: string | null;
  sectionName: string | null;
};

const LIMITS = { name: 120, description: 600, section: 80 } as const;

function clean(value: string | null | undefined, max: number) {
  return (value ?? "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Fingerprint of the approved descriptive context a candidate was generated
 * from. If the item's name or description changes, the candidate is stale and
 * must be regenerated before it can be accepted.
 */
export function aiPhotoContextSha256(context: AiPhotoProductContext) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: clean(context.displayName, LIMITS.name),
        description: clean(context.description, LIMITS.description),
      }),
    )
    .digest("hex");
}

/**
 * Builds the provider prompt from approved English menu text only. Merchant
 * text is quoted as data; the image is framed as illustrative so the result is
 * never presented as a photo of the real dish.
 */
export function buildAiPhotoPrompt(context: AiPhotoProductContext) {
  const name = clean(context.displayName, LIMITS.name);
  const description = clean(context.description, LIMITS.description);
  const section = clean(context.sectionName, LIMITS.section);

  return [
    "Create an appetising, realistic illustrative image of a single restaurant menu item for a digital menu.",
    `Menu item name: "${name}".`,
    description ? `Menu description: "${description}".` : null,
    section ? `Menu section: "${section}".` : null,
    "Show only what the name and description imply; do not add garnishes, sides or props that are not mentioned.",
    "Square composition, item centred, soft natural light, clean neutral background.",
    "No text, lettering, logos, watermarks, people or hands.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
