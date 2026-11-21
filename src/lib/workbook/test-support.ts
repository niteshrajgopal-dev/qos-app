import { deflateRawSync } from "node:zlib";

import ExcelJS from "exceljs";

import { crc32 } from "@/lib/workbook/zip";

/* Test-only helpers: a tiny zip writer that can also forge headers (to build
   zip bombs, unsafe names and corrupt archives in memory), and exceljs
   helpers to fill a generated template like a person would in Excel. No
   binary fixtures are committed. */

export type TestZipEntry = {
  name: string;
  data: Buffer | string;
  store?: boolean;
  /** Override the declared uncompressed size (forged header). */
  declaredSize?: number;
  /** Override the general-purpose flags (bit 0 marks encryption). */
  flags?: number;
  /** Override the compression method. */
  method?: number;
};

export function writeTestZip(entries: TestZipEntry[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = entry.store ? data : deflateRawSync(data);
    const method = entry.method ?? (entry.store ? 0 : 8);
    const flags = entry.flags ?? 0x0800;
    const name = Buffer.from(entry.name, "utf8");
    const size = entry.declaredSize ?? data.length;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, end]);
}

export async function loadWorkbook(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook;
}

export async function saveWorkbook(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Writes rows into a sheet's table area, starting at its first data row,
 * matching cells to header names on the header row. Values are written as
 * strings unless a number or formula object is given.
 */
export function fillSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  headerRow: number,
  rows: Array<Record<string, ExcelJS.CellValue>>,
) {
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    throw new Error(`Missing sheet ${sheetName}`);
  }
  const columns = new Map<string, number>();
  worksheet.getRow(headerRow).eachCell((cell, column) => {
    columns.set(String(cell.value), column);
  });
  rows.forEach((values, index) => {
    for (const [key, value] of Object.entries(values)) {
      const column = columns.get(key);
      if (!column) {
        throw new Error(`Missing column ${key} on ${sheetName}`);
      }
      worksheet.getCell(headerRow + 1 + index, column).value = value;
    }
  });
}

/** The context cell (value column) for one manifest field on Start Here. */
export function setManifestValue(workbook: ExcelJS.Workbook, field: string, value: ExcelJS.CellValue) {
  const worksheet = workbook.getWorksheet("Start Here")!;
  let found = false;
  worksheet.eachRow((row) => {
    if (row.getCell(1).value === field) {
      row.getCell(2).value = value;
      found = true;
    }
  });
  if (!found) {
    throw new Error(`Missing manifest field ${field}`);
  }
}
