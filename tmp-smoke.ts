import { buildFoodicsMenuFixture } from "@/lib/workbook/foodics-menu/fixture";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { toReviewInput } from "@/lib/workbook/validation/input";
import { buildReviewSnapshot } from "@/lib/workbook/validation/snapshot";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
(async () => {
  const bytes = await buildFoodicsMenuFixture({ filled: true });
  const r = await parseWorkbookUpload({ fileName: "x.xlsx", bytes }, { tenantPublicId: "ten_q", brandPublicIds: ["brd_q"], tenantCurrency: "AED", brandPublicId: "brd_q", brandChoices: [{publicId:"brd_q",name:"Q"}] });
  const input = toReviewInput(r, { tenantPublicId: "ten_q", brandPublicId: "brd_q", currency: "AED" });
  const snap = buildReviewSnapshot({ tenantPublicId: "ten_q", brandPublicId: "brd_q", currency: "AED", businessProfile: "hospitality", records: {}, permittedBranches: [], allBranchPublicIds: [] });
  const review = reviewWorkbook(input, snap, []);
  console.log(JSON.stringify(review.counts));
  for (const row of review.rows) console.log(row.sheet, row.row, row.classification, row.operation, row.label.en, "|", row.diagnostics.map(d=>d.severity[0]+":"+d.code+(d.column?"@"+d.column:"")).join(","), row.deferredFields.map(f=>f.column+"="+f.value+(f.display?JSON.stringify(f.display):"")).join(";"));
  console.log(JSON.stringify(review.acknowledgements.required));
})();
