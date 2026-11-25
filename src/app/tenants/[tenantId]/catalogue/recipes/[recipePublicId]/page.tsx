import { RecipeEditorScreen } from "../recipe-editor";

type PageProps = {
  params: Promise<{ tenantId: string; recipePublicId: string }>;
};

export default async function RecipePage({ params }: PageProps) {
  const { tenantId, recipePublicId } = await params;
  return <RecipeEditorScreen tenantId={tenantId} recipePublicId={recipePublicId} />;
}
