import { RecipesScreen } from "./recipes-screen";
import { recipesTabFrom } from "./recipes-tabs";

type PageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function TenantRecipesPage({ params, searchParams }: PageProps) {
  const { tenantId } = await params;
  const { tab } = await searchParams;
  return <RecipesScreen tenantId={tenantId} initialTab={recipesTabFrom(tab)} />;
}
