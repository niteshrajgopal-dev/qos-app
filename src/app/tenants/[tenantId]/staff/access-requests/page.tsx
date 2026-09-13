import { AccessRequestsReview } from "@/app/tenants/[tenantId]/staff/access-requests/access-requests-review";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function StaffAccessRequestsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Access requests"
      subtitle="Administrators approve or reject staff who asked to join this business."
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/staff/audit`}
          variant="ghost"
        >
          Audit log
        </ButtonLink>
      }
    >
      <AccessRequestsReview tenantId={tenantId} />
    </StaffScreen>
  );
}
