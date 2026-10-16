import type { DescriptionSourceFacts } from "@/lib/catalogue/description-draft/validator";

export const CATALOGUE_DESCRIPTION_PROMPT_VERSION = "catalogue_description_prompt.v1";

export const DESCRIPTION_SYSTEM_INSTRUCTIONS = [
  "You improve English catalogue product descriptions for hospitality staff review.",
  "Write only in English. Do not translate or output Arabic.",
  "Preserve every factual claim from the source (allergens, nutrition, origin, certifications, ingredients).",
  "Do not invent or add allergens, nutrition facts, origin, certifications, health claims, or ingredients that are not clearly present in the source.",
  "Do not change the product display name.",
  "Return a single JSON object only, with no markdown or commentary.",
].join("\n");

export function buildDescriptionModelRequest(input: {
  facts: DescriptionSourceFacts;
}): string {
  const payload = {
    schema: "qos.catalogue_description_input.v1",
    locale: "en",
    displayName: input.facts.displayName,
    description: input.facts.description,
    nutritionCalories: input.facts.nutritionCalories,
  };
  return [
    "Improve the English product description using only the facts below.",
    JSON.stringify(payload),
    'Return JSON: {"schema":"qos.catalogue_description_result.v1","description":...}',
  ].join("\n\n");
}
