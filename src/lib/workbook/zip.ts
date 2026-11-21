import { inflateRawSync } from "node:zlib";

import { WorkbookParseError } from "@/lib/workbook/errors";

/* Bounded reader for the zip container of an uploaded XLSX. Nothing is
   written to disk, so entry names can never escape a directory, but names
   that would (absolute, `..`, backslashes, drive letters) are still refused
   as a sign of a crafted file. Sizes are capped from the central directory
   and again while inflating (`maxOutputLength`), so a zip bomb fails before
   it can fill memory. Encrypted entries, zip64 and methods other than
   store/deflate are refused. */

export type ZipLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
};

type ZipEntry = {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export type ZipArchive = {
  names: string[];
  has(name: string): boolean;
  read(name: string): Buffer;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const MAX_NAME_LENGTH = 512;

export const ZIP_LOCAL_SIGNATURE_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function looksLikeZip(bytes: Buffer) {
  return bytes.length >= 4 && bytes.subarray(0, 4).equals(ZIP_LOCAL_SIGNATURE_BYTES);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function malformed(detail: string): never {
  throw new WorkbookParseError("malformed_workbook", `The workbook is not a readable XLSX file (${detail}).`);
}

function unsafe(detail: string): never {
  throw new WorkbookParseError("unsafe_workbook", `The workbook was refused for safety (${detail}).`);
}

function tooLarge(limits: ZipLimits): never {
  throw new WorkbookParseError(
    "workbook_too_large",
    `The workbook expands beyond the ${limits.maxTotalBytes}-byte limit.`,
    { maxBytes: limits.maxTotalBytes },
  );
}

function isSafeEntryName(name: string) {
  if (!name || name.length > MAX_NAME_LENGTH) {
    return false;
  }
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/")) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(name)) {
    return false;
  }
  return !name.split("/").some((segment) => segment === "..");
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const lowest = Math.max(0, bytes.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH);
  for (let offset = bytes.length - EOCD_MIN_LENGTH; offset >= lowest; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return malformed("no end of central directory");
}

export function openZip(bytes: Buffer, limits: ZipLimits): ZipArchive {
  if (bytes.length < EOCD_MIN_LENGTH || !looksLikeZip(bytes)) {
    malformed("not a zip container");
  }

  const eocd = findEndOfCentralDirectory(bytes);
  const diskNumber = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);

  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    unsafe("zip64 archives are not accepted");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    unsafe("multi-part archives are not accepted");
  }
  if (totalEntries > limits.maxEntries) {
    throw new WorkbookParseError(
      "workbook_too_large",
      `The workbook has more than ${limits.maxEntries} internal parts.`,
      { maxEntries: limits.maxEntries },
    );
  }
  if (centralOffset + centralSize > eocd) {
    malformed("central directory out of range");
  }

  const entries = new Map<string, ZipEntry>();
  let declaredTotal = 0;
  let cursor = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      malformed("central directory entry");
    }

    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;

    if (nameEnd > eocd) {
      malformed("entry name out of range");
    }

    const name = bytes.toString(flags & 0x0800 ? "utf8" : "latin1", cursor + 46, nameEnd);

    if (!isSafeEntryName(name)) {
      unsafe("an internal path points outside the workbook");
    }
    if (flags & 0x0001) {
      unsafe("encrypted parts are not accepted");
    }
    if (method !== 0 && method !== 8) {
      unsafe("unsupported compression method");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      unsafe("zip64 archives are not accepted");
    }
    if (entries.has(name)) {
      unsafe("duplicate internal part names");
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new WorkbookParseError(
        "workbook_too_large",
        `A workbook part expands beyond the ${limits.maxEntryBytes}-byte limit.`,
        { maxBytes: limits.maxEntryBytes },
      );
    }

    declaredTotal += uncompressedSize;
    if (declaredTotal > limits.maxTotalBytes) {
      tooLarge(limits);
    }

    entries.set(name, {
      name,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor = nameEnd + extraLength + commentLength;
  }

  let inflatedTotal = 0;

  function read(name: string) {
    const entry = entries.get(name);
    if (!entry) {
      return malformed(`missing part ${name}`);
    }

    const local = entry.localHeaderOffset;
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== LOCAL_SIGNATURE) {
      malformed("local header");
    }
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) {
      malformed("part data out of range");
    }

    const compressed = bytes.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (entry.method === 0) {
      data = Buffer.from(compressed);
    } else {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, limits.maxEntryBytes) });
      } catch (error) {
        if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new WorkbookParseError(
            "workbook_too_large",
            `A workbook part expands beyond the ${limits.maxEntryBytes}-byte limit.`,
            { maxBytes: limits.maxEntryBytes },
          );
        }
        return malformed("corrupt compressed data");
      }
    }

    if (data.length !== entry.uncompressedSize) {
      malformed("part size does not match its header");
    }
    if (crc32(data) !== entry.crc32) {
      malformed("part checksum mismatch");
    }

    inflatedTotal += data.length;
    if (inflatedTotal > limits.maxTotalBytes) {
      tooLarge(limits);
    }

    return data;
  }

  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read,
  };
}

/** Inflates every part once within the limits; used before handing bytes to exceljs. */
export function assertZipWithinLimits(bytes: Buffer, limits: ZipLimits) {
  const archive = openZip(bytes, limits);
  for (const name of archive.names) {
    archive.read(name);
  }
}
