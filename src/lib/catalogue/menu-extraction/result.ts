import { z } from "zod";

import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import type { MenuExtractionCandidatePayload, MenuExtractionUncertainty } from "@/db/schema";

export const MENU_EXTRACTION_INPUT_SCHEMA = "qos.catalogue_menu_extraction_input.v1";
export const MENU_EXTRACTION_RESULT_SCHEMA = "qos.catalogue_menu_extraction_result.v1";

const uncertaintySchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "missing",
  "contradictory",
]);

const bboxSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0).max(1),
  height: z.number().finite().min(0).max(1),
});

const evidenceSchema = z.strictObject({
  pageNumber: z.number().int().positive(),
  bbox: bboxSchema.nullable(),
  originalText: z.string().max(4000).nullable(),
});

const itemSchema = z.strictObject({
  candidateKey: z.string().trim().min(1).max(120),
  sectionName: z.string().trim().max(200).nullable(),
  displayNameEn: z.string().trim().max(200).nullable(),
  displayNameAr: z.string().trim().max(200).nullable(),
  descriptionEn: z.string().trim().max(2000).nullable(),
  descriptionAr: z.string().trim().max(2000).nullable(),
  variantLabelEn: z.string().trim().max(120).nullable(),
  variantLabelAr: z.string().trim().max(120).nullable(),
  priceText: z.string().trim().max(120).nullable(),
  amountMinor: z.number().int().nonnegative().nullable(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  allergenText: z.string().trim().max(500).nullable(),
  unitText: z.string().trim().max(120).nullable(),
  uncertainty: z.strictObject({
    displayNameEn: uncertaintySchema,
    displayNameAr: uncertaintySchema,
    descriptionEn: uncertaintySchema,
    descriptionAr: uncertaintySchema,
    price: uncertaintySchema,
    allergen: uncertaintySchema,
    unit: uncertaintySchema,
  }),
  evidence: evidenceSchema,
  modelConfidenceEstimate: z.string().trim().max(40).nullable(),
});

export const menuExtractionResultZod = z.strictObject({
  schema: z.literal(MENU_EXTRACTION_RESULT_SCHEMA),
  modelConfidenceEstimateLabel: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional(),
  items: z.array(itemSchema).max(500),
});

export type MenuExtractionModelItem = z.infer<typeof itemSchema>;

export type MenuExtractionReplyContext = {
  sourcePublicId: string;
  pageCount: number;
};

export function interpretMenuExtractionModelReply(
  finalMessage: string,
  context: MenuExtractionReplyContext,
): CompletionInterpretation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalMessage);
  } catch {
    return {
      ok: false,
      code: "model_output_invalid_json",
      message: "The model did not return valid JSON.",
      rawResultExcerpt: finalMessage.slice(0, 500),
    };
  }

  const validated = menuExtractionResultZod.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      code: "model_output_schema_mismatch",
      message: "The model output did not match the menu extraction schema.",
      rawResultExcerpt: finalMessage.slice(0, 500),
    };
  }

  const items: MenuExtractionCandidatePayload[] = [];
  for (const item of validated.data.items) {
    if (item.evidence.pageNumber > context.pageCount) {
      return {
        ok: false,
        code: "model_output_invalid_evidence",
        message: "A candidate referenced a page outside the uploaded source.",
        rawResultExcerpt: finalMessage.slice(0, 500),
      };
    }
    if (item.amountMinor === 0) {
      return {
        ok: false,
        code: "model_output_zero_price",
        message: "Extracted prices must be null when unknown, never zero.",
        rawResultExcerpt: finalMessage.slice(0, 500),
      };
    }
    items.push({
      schema: "qos.catalogue_menu_extraction_candidate.v1",
      candidateKey: item.candidateKey,
      sectionName: item.sectionName,
      displayNameEn: item.displayNameEn,
      displayNameAr: item.displayNameAr,
      descriptionEn: item.descriptionEn,
      descriptionAr: item.descriptionAr,
      variantLabelEn: item.variantLabelEn,
      variantLabelAr: item.variantLabelAr,
      priceText: item.priceText,
      amountMinor: item.amountMinor,
      currency: item.currency,
      allergenText: item.allergenText,
      unitText: item.unitText,
      uncertainty: item.uncertainty as MenuExtractionCandidatePayload["uncertainty"],
      evidence: item.evidence,
      modelConfidenceEstimate: item.modelConfidenceEstimate,
    });
  }

  return {
    ok: true,
    result: {
      schema: MENU_EXTRACTION_RESULT_SCHEMA,
      sourcePublicId: context.sourcePublicId,
      itemCount: items.length,
      items,
      modelConfidenceEstimateLabel:
        validated.data.modelConfidenceEstimateLabel ??
        "Model confidence is an estimate only, not verified accuracy.",
    },
  };
}
