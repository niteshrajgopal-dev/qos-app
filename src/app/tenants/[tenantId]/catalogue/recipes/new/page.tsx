import { RecipeEditorScreen } from "../recipe-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewRecipePage({ params }: PageProps) {
  const { tenantId } = await params;
  return <RecipeEditorScreen tenantId={tenantId} />;
}
