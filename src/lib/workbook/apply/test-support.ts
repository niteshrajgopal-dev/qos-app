import type { ApplyHooks, ImageIngester } from "@/lib/workbook/apply/handlers/types";

/* Test-only seams for the apply engine (QOS-217). Not imported by any route. */

/** Throws inside the unit of `sheet` row `row`, after its service calls and links, before audit and checkpoint. */
export function faultAt(sheet: string, row: number): ApplyHooks["beforeCheckpoint"] {
  return (unit) => {
    if (unit.sheet === sheet && unit.rows.includes(row)) {
      throw new Error(`Injected apply fault at ${sheet} row ${row}`);
    }
  };
}

/** Records image requests instead of fetching them. */
export function fakeImageIngester(outcome: "uploaded" | "already_present" | Error = "uploaded") {
  const calls: Array<{ productPublicId: string; url: string }> = [];
  const ingest: ImageIngester = async ({ productPublicId, url }) => {
    calls.push({ productPublicId, url });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { ingest, calls };
}
