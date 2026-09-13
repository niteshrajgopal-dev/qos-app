import { writeWorksheetMatrix } from "@/lib/catalogue/catalogue-import-xlsx";

export const CATALOGUE_IMPORT_SAMPLE_ROWS = [
  {
    source_id: "quotes-fw-001",
    internal_name: "flat-white",
    display_name_en: "Flat White",
    display_name_ar: "فلات وايت",
    amount_minor: "1800",
    currency: "AED",
  },
  {
    source_id: "quotes-es-002",
    internal_name: "espresso-single",
    display_name_en: "Single Espresso",
    display_name_ar: "إسpresso مفرد",
    amount_minor: "1200",
    currency: "AED",
  },
  {
    source_id: "quotes-formula-003",
    internal_name: "formula-safe",
    display_name_en: "=SUM(1,2)",
    display_name_ar: "+formula",
    amount_minor: "900",
    currency: "AED",
  },
] as const;

function csvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export const CATALOGUE_IMPORT_SAMPLE_CSV = [
  "source_id,internal_name,display_name_en,display_name_ar,amount_minor,currency",
  ...CATALOGUE_IMPORT_SAMPLE_ROWS.map((row) =>
    [
      row.source_id,
      row.internal_name,
      row.display_name_en,
      row.display_name_ar,
      row.amount_minor,
      row.currency,
    ]
      .map(csvCell)
      .join(","),
  ),
].join("\n");

export async function buildCatalogueImportSampleXlsx() {
  return writeWorksheetMatrix("catalogue", [
    [
      "source_id",
      "internal_name",
      "display_name_en",
      "display_name_ar",
      "amount_minor",
      "currency",
    ],
    ...CATALOGUE_IMPORT_SAMPLE_ROWS.map((row) => [
      row.source_id,
      row.internal_name,
      row.display_name_en,
      row.display_name_ar,
      row.amount_minor,
      row.currency,
    ]),
  ]);
}
