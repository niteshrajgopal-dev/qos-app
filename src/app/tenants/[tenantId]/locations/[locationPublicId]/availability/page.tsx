import { LocationAvailabilityPanel } from "@/app/tenants/[tenantId]/locations/[locationPublicId]/availability/location-availability-panel";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; locationPublicId: string }>;
};

export default async function LocationAvailabilityPage({ params }: PageProps) {
  const { tenantId, locationPublicId } = await params;

  return (
    <StaffScreen
      title="Location availability"
      subtitle={`Hours, exceptions, and stop-sales for ${locationPublicId}.`}
      actions={
        <ButtonLink href={`/tenants/${tenantId}/locations`} variant="ghost">
          All locations
        </ButtonLink>
      }
    >
      <LocationAvailabilityPanel
        tenantId={tenantId}
        locationPublicId={locationPublicId}
      />
    </StaffScreen>
  );
}
