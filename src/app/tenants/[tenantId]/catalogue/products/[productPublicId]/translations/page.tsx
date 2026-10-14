import { AiTranslationReview } from "@/app/tenants/[tenantId]/catalogue/products/[productPublicId]/translations/ai-translation-review";
import { TranslationReview } from "@/app/tenants/[tenantId]/catalogue/products/[productPublicId]/translations/translation-review";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export default async function ProductTranslationReviewPage({
  params,
}: PageProps) {
  const { tenantId, productPublicId } = await params;

  return (
    <StaffScreen
      title="Translation review"
      subtitle={`Approve English and Arabic copy for ${productPublicId}.`}
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/edit`}
          variant="ghost"
        >
          Back to product
        </ButtonLink>
      }
    >
      <div className="space-y-10">
        <AiTranslationReview
          tenantId={tenantId}
          productPublicId={productPublicId}
          uiLocale="en"
        />
        <TranslationReview
          tenantId={tenantId}
          productPublicId={productPublicId}
        />
      </div>
    </StaffScreen>
  );
}
