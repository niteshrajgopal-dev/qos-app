import { UnitEditor } from "../../unit-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
};

export default async function NewInventoryUnitPage({ params, searchParams }: PageProps) {
  const { tenantId } = await params;
  const { source } = await searchParams;
  return <UnitEditor tenantId={tenantId} mode={source === "custom" ? "custom" : "standard"} />;
}
