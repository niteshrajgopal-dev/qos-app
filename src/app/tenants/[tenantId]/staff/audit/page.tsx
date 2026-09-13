import { TenantAuditViewer } from "@/app/tenants/[tenantId]/staff/audit/tenant-audit-viewer";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantAuditPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <StaffScreen
      title="Audit log"
      subtitle="Read-only protected change history for this business."
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/staff/access-requests`}
          variant="ghost"
        >
          Access requests
        </ButtonLink>
      }
    >
      <TenantAuditViewer tenantId={tenantId} />
    </StaffScreen>
  );
}
