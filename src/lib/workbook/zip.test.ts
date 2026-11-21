import { describe, expect, it } from "vitest";

import { WorkbookParseError } from "@/lib/workbook/errors";
import { writeTestZip } from "@/lib/workbook/test-support";
import { crc32, openZip, type ZipLimits } from "@/lib/workbook/zip";

const LIMITS: ZipLimits = { maxEntries: 8, maxEntryBytes: 64 * 1024, maxTotalBytes: 128 * 1024 };

function errorCode(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof WorkbookParseError) return error.code;
    throw error;
  }
  return "no error";
}

describe("bounded zip reader", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("reads stored and deflated parts and verifies their checksums", () => {
    const archive = openZip(
      writeTestZip([
        { name: "xl/workbook.xml", data: "<workbook/>" },
        { name: "docProps/app.xml", data: "stored", store: true },
      ]),
      LIMITS,
    );
    expect(archive.names).toEqual(["xl/workbook.xml", "docProps/app.xml"]);
    expect(archive.read("xl/workbook.xml").toString()).toBe("<workbook/>");
    expect(archive.read("docProps/app.xml").toString()).toBe("stored");
  });

  it("refuses a zip bomb whose part inflates past the per-part limit even when its header lies", () => {
    const bomb = Buffer.alloc(LIMITS.maxEntryBytes * 4, 0x41);
    const archive = openZip(writeTestZip([{ name: "xl/worksheets/sheet1.xml", data: bomb, declaredSize: 100 }]), LIMITS);
    expect(errorCode(() => archive.read("xl/worksheets/sheet1.xml"))).toBe("workbook_too_large");
  });

  it("refuses parts whose declared size is over the limit before inflating them", () => {
    const zip = writeTestZip([{ name: "a.xml", data: "x", declaredSize: LIMITS.maxEntryBytes + 1 }]);
    expect(errorCode(() => openZip(zip, LIMITS))).toBe("workbook_too_large");
  });

  it("refuses archives whose parts together expand past the total limit", () => {
    const part = Buffer.alloc(LIMITS.maxEntryBytes - 1, 0x42);
    const zip = writeTestZip([
      { name: "a.xml", data: part },
      { name: "b.xml", data: part },
      { name: "c.xml", data: part },
    ]);
    expect(errorCode(() => openZip(zip, LIMITS))).toBe("workbook_too_large");
  });

  it("refuses archives with too many parts", () => {
    const zip = writeTestZip(Array.from({ length: LIMITS.maxEntries + 1 }, (_, index) => ({ name: `p${index}.xml`, data: "x" })));
    expect(errorCode(() => openZip(zip, LIMITS))).toBe("workbook_too_large");
  });

  it.each(["../evil.xml", "/etc/passwd", "xl\\..\\evil.xml", "C:/evil.xml", "xl/../../evil.xml"])(
    "refuses the zip-slip part name %s",
    (name) => {
      expect(errorCode(() => openZip(writeTestZip([{ name, data: "x" }]), LIMITS))).toBe("unsafe_workbook");
    },
  );

  it("refuses encrypted parts, unknown compression and duplicate names", () => {
    expect(errorCode(() => openZip(writeTestZip([{ name: "a.xml", data: "x", flags: 0x0801 }]), LIMITS))).toBe("unsafe_workbook");
    expect(errorCode(() => openZip(writeTestZip([{ name: "a.xml", data: "x", method: 12 }]), LIMITS))).toBe("unsafe_workbook");
    expect(
      errorCode(() =>
        openZip(
          writeTestZip([
            { name: "a.xml", data: "x" },
            { name: "a.xml", data: "y" },
          ]),
          LIMITS,
        ),
      ),
    ).toBe("unsafe_workbook");
  });

  it("reports truncated and corrupted archives as malformed", () => {
    const zip = writeTestZip([{ name: "a.xml", data: "<a>hello</a>" }]);
    expect(errorCode(() => openZip(zip.subarray(0, zip.length - 10), LIMITS))).toBe("malformed_workbook");
    expect(errorCode(() => openZip(Buffer.from("PK\u0003\u0004 not really a zip at all, no directory"), LIMITS))).toBe(
      "malformed_workbook",
    );

    const corrupted = Buffer.from(zip);
    const dataStart = 30 + "a.xml".length;
    corrupted[dataStart] = corrupted[dataStart]! ^ 0xff;
    expect(errorCode(() => openZip(corrupted, LIMITS).read("a.xml"))).toBe("malformed_workbook");
  });
});
