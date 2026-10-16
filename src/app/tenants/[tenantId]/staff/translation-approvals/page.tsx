import { TranslationApprovalsReview } from "@/app/tenants/[tenantId]/staff/translation-approvals/translation-approvals-review";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TranslationApprovalsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Translation approvals"
      subtitle="Review AI-assisted catalogue copy before it can publish."
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue`}
          variant="ghost"
        >
          Catalogue
        </ButtonLink>
      }
    >
      <TranslationApprovalsReview tenantId={tenantId} />
    </StaffScreen>
  );
}
