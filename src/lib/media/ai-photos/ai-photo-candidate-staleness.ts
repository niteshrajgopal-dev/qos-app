import { aiPhotoContextSha256, type AiPhotoProductContext } from "@/lib/media/ai-photos/prompt";

export type AiPhotoCandidateStalenessInput = {
  metadata: {
    contextSha256?: string;
    productVersion?: number;
  };
  product: { version: number; context: AiPhotoProductContext };
};

/** True when accept would return stale_candidate for a pending AI photo candidate. */
export function isAiPhotoCandidateStale({ metadata, product }: AiPhotoCandidateStalenessInput): boolean {
  const contextSha256 = aiPhotoContextSha256(product.context);
  const staleContext = metadata.contextSha256 !== contextSha256;
  // Legacy candidates omit productVersion; only the context hash applies to them.
  const staleRevision =
    metadata.productVersion !== undefined && metadata.productVersion !== product.version;
  return staleContext || staleRevision;
}
