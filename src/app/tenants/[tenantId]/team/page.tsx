import { TeamScreen } from "@/components/staff/team-screen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantTeamPage({ params }: PageProps) {
  const { tenantId } = await params;

  return <TeamScreen tenantId={tenantId} />;
}
