import Link from "next/link";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

const LINKS = [
  {
    href: "products/new",
    title: "New draft product",
    body: "Create a bilingual product, then approve EN and AR before it can go on a menu.",
  },
  {
    href: "menus",
    title: "Menus",
    body: "Build sections, place items, and publish to selected locations.",
  },
  {
    href: "modifier-groups",
    title: "Modifier groups",
    body: "Reusable options such as milk, size, or add-ons.",
  },
  {
    href: "categories",
    title: "Categories",
    body: "Group products for staff merchandising. Published menus still use menu sections.",
  },
  {
    href: "import",
    title: "Import",
    body: "Preview and apply a catalogue file for this business.",
  },
] as const;

export default async function CatalogueHubPage({ params }: PageProps) {
  const { tenantId } = await params;

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div className="qos-pagehead">
        <div>
          <h1 className="qos-pagetitle">Catalogue</h1>
          <p className="qos-pagesub">
            Products, menus, modifiers, categories, and import.
          </p>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={`/tenants/${tenantId}/catalogue/${link.href}`}
            className="qos-card"
            data-padding="sm"
            data-interactive="true"
          >
            <strong>{link.title}</strong>
            <p className="qos-card-sub">{link.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
