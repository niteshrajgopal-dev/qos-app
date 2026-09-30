import { LocationsScreen } from "@/components/staff/locations-screen";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantLocationsPage({ params }: PageProps) {
  const { tenantId } = await params;

  return <LocationsScreen tenantId={tenantId} />;
}
