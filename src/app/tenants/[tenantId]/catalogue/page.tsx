import { CatalogueProductsList } from "@/components/platform/catalogue-products-list";
import { ButtonLink } from "@/components/ButtonLink";
import { Card } from "@/design-system";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function CatalogueHubPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <CatalogueProductsList tenantId={tenantId} />

      <Card>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 500 }}>
          Catalogue management
        </h3>
        <div style={{ display: "grid", gap: 12 }}>
          <ButtonLink
            href={`/tenants/${tenantId}/catalogue/menus`}
            variant="secondary"
          >
            Menus
          </ButtonLink>
          <ButtonLink
            href={`/tenants/${tenantId}/catalogue/modifier-groups`}
            variant="secondary"
          >
            Modifier groups
          </ButtonLink>
          <ButtonLink
            href={`/tenants/${tenantId}/catalogue/categories`}
            variant="secondary"
          >
            Categories
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

