import { UnitEditor } from "../../../unit-editor";

type PageProps = {
  params: Promise<{ tenantId: string; unitPublicId: string }>;
};

export default async function EditInventoryUnitPage({ params }: PageProps) {
  const { tenantId, unitPublicId } = await params;
  return <UnitEditor tenantId={tenantId} mode="edit" unitPublicId={unitPublicId} />;
}
