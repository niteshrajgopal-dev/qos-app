import { RecipeVersionScreen } from "../../../recipe-version-screen";

type PageProps = {
  params: Promise<{ tenantId: string; recipePublicId: string; versionPublicId: string }>;
};

export default async function RecipeVersionPage({ params }: PageProps) {
  const { tenantId, recipePublicId, versionPublicId } = await params;
  return <RecipeVersionScreen tenantId={tenantId} recipePublicId={recipePublicId} versionPublicId={versionPublicId} />;
}
