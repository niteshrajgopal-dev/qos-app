import { ChannelsScreen } from "@/components/staff/channels-screen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantChannelsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return <ChannelsScreen tenantId={tenantId} />;
}
