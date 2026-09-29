import { describe, expect, it } from "vitest";

import { formatMinorAmount, sharePercent } from "@/lib/staff/overview";

describe("sharePercent", () => {
  it("returns a whole percentage", () => {
    expect(sharePercent(3, 4)).toBe(75);
  });

  it("rounds to the nearest whole percent", () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(67);
  });

  it("returns null when there is nothing to divide by", () => {
    expect(sharePercent(0, 0)).toBeNull();
    expect(sharePercent(5, 0)).toBeNull();
  });

  it("reports a complete share as 100", () => {
    expect(sharePercent(4, 4)).toBe(100);
  });
});

describe("formatMinorAmount", () => {
  it("converts minor units to grouped major units", () => {
    expect(formatMinorAmount(2486000)).toBe("24,860.00");
  });

  it("keeps two fraction digits", () => {
    expect(formatMinorAmount(1)).toBe("0.01");
    expect(formatMinorAmount(0)).toBe("0.00");
  });
});
