import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";
import { CHANNEL_PRICE_APPLY_OWNER } from "@/lib/workbook/channel-price-capabilities";

/* v1.2 sales-channel sheets have catalogue services, but workbook apply is
   QOS-200. Review never proposes a write in this leaf, so a unit here means
   a tampered plan; it fails closed. */
export const applyChannelSheets: SheetHandler = async () => {
  throw new ApplyUnitError("unsupported_field", `Sales-channel sheets are applied by ${CHANNEL_PRICE_APPLY_OWNER}.`, {
    reason: "channel_prices_qos_200",
  });
};
