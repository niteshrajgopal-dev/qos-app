import { describe, expect, test } from "vitest";

import {
  validateVideoUploadBytes,
  VideoUploadValidationError,
} from "./video-upload-validation";

describe("validateVideoUploadBytes", () => {
  test("accepts minimal valid MP4 ftyp header", () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(32, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("rejects file too small for ftyp atom", () => {
    const bytes = Buffer.alloc(4);
    bytes.write("ftyp", 0, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      "Only MP4 video uploads are supported.",
    );
  });

  test("rejects file without ftyp atom", () => {
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(16, 0);
    bytes.write("mdat", 4, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
  });

  test("rejects QuickTime qt__ brand", () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(32, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("qt  ", 8, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
  });

  test("rejects QuickTime qtif brand", () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(32, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("qtif", 8, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
  });

  test("accepts MP4 with H.264 (avc1) codec in moov", () => {
    const ftypSize = 32;
    const moovSize = 120;
    const totalSize = ftypSize + moovSize;

    const bytes = Buffer.alloc(totalSize);

    bytes.writeUInt32BE(ftypSize, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    const moovOffset = ftypSize;
    bytes.writeUInt32BE(moovSize, moovOffset);
    bytes.write("moov", moovOffset + 4, "ascii");

    const trakOffset = moovOffset + 8;
    const trakSize = moovSize - 8;
    bytes.writeUInt32BE(trakSize, trakOffset);
    bytes.write("trak", trakOffset + 4, "ascii");

    const mdiaOffset = trakOffset + 8;
    const mdiaSize = trakSize - 8;
    bytes.writeUInt32BE(mdiaSize, mdiaOffset);
    bytes.write("mdia", mdiaOffset + 4, "ascii");

    const minfOffset = mdiaOffset + 8;
    const minfSize = mdiaSize - 8;
    bytes.writeUInt32BE(minfSize, minfOffset);
    bytes.write("minf", minfOffset + 4, "ascii");

    const stblOffset = minfOffset + 8;
    const stblSize = minfSize - 8;
    bytes.writeUInt32BE(stblSize, stblOffset);
    bytes.write("stbl", stblOffset + 4, "ascii");

    const stsdOffset = stblOffset + 8;
    const stsdSize = stblSize - 8;
    bytes.writeUInt32BE(stsdSize, stsdOffset);
    bytes.write("stsd", stsdOffset + 4, "ascii");
    bytes.writeUInt32BE(0, stsdOffset + 8);
    bytes.writeUInt32BE(1, stsdOffset + 12);
    bytes.write("avc1", stsdOffset + 16, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("accepts MP4 with H.265 (hvc1) codec in moov", () => {
    const ftypSize = 32;
    const moovSize = 120;
    const totalSize = ftypSize + moovSize;

    const bytes = Buffer.alloc(totalSize);

    bytes.writeUInt32BE(ftypSize, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    const moovOffset = ftypSize;
    bytes.writeUInt32BE(moovSize, moovOffset);
    bytes.write("moov", moovOffset + 4, "ascii");

    const trakOffset = moovOffset + 8;
    const trakSize = moovSize - 8;
    bytes.writeUInt32BE(trakSize, trakOffset);
    bytes.write("trak", trakOffset + 4, "ascii");

    const mdiaOffset = trakOffset + 8;
    const mdiaSize = trakSize - 8;
    bytes.writeUInt32BE(mdiaSize, mdiaOffset);
    bytes.write("mdia", mdiaOffset + 4, "ascii");

    const minfOffset = mdiaOffset + 8;
    const minfSize = mdiaSize - 8;
    bytes.writeUInt32BE(minfSize, minfOffset);
    bytes.write("minf", minfOffset + 4, "ascii");

    const stblOffset = minfOffset + 8;
    const stblSize = minfSize - 8;
    bytes.writeUInt32BE(stblSize, stblOffset);
    bytes.write("stbl", stblOffset + 4, "ascii");

    const stsdOffset = stblOffset + 8;
    const stsdSize = stblSize - 8;
    bytes.writeUInt32BE(stsdSize, stsdOffset);
    bytes.write("stsd", stsdOffset + 4, "ascii");
    bytes.writeUInt32BE(0, stsdOffset + 8);
    bytes.writeUInt32BE(1, stsdOffset + 12);
    bytes.write("hvc1", stsdOffset + 16, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("rejects MP4 with disallowed codec (not avc1/hvc1/hev1)", () => {
    const ftypSize = 32;
    const moovSize = 120;
    const totalSize = ftypSize + moovSize;

    const bytes = Buffer.alloc(totalSize);

    bytes.writeUInt32BE(ftypSize, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    const moovOffset = ftypSize;
    bytes.writeUInt32BE(moovSize, moovOffset);
    bytes.write("moov", moovOffset + 4, "ascii");

    const trakOffset = moovOffset + 8;
    const trakSize = moovSize - 8;
    bytes.writeUInt32BE(trakSize, trakOffset);
    bytes.write("trak", trakOffset + 4, "ascii");

    const mdiaOffset = trakOffset + 8;
    const mdiaSize = trakSize - 8;
    bytes.writeUInt32BE(mdiaSize, mdiaOffset);
    bytes.write("mdia", mdiaOffset + 4, "ascii");

    const minfOffset = mdiaOffset + 8;
    const minfSize = mdiaSize - 8;
    bytes.writeUInt32BE(minfSize, minfOffset);
    bytes.write("minf", minfOffset + 4, "ascii");

    const stblOffset = minfOffset + 8;
    const stblSize = minfSize - 8;
    bytes.writeUInt32BE(stblSize, stblOffset);
    bytes.write("stbl", stblOffset + 4, "ascii");

    const stsdOffset = stblOffset + 8;
    const stsdSize = stblSize - 8;
    bytes.writeUInt32BE(stsdSize, stsdOffset);
    bytes.write("stsd", stsdOffset + 4, "ascii");
    bytes.writeUInt32BE(0, stsdOffset + 8);
    bytes.writeUInt32BE(1, stsdOffset + 12);
    bytes.write("vp09", stsdOffset + 16, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
  });

  test("accepts MP4 when moov is not found in first 100KB", () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(32, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("accepts MP4 when stsd is not reachable", () => {
    const ftypSize = 32;
    const moovSize = 40;
    const totalSize = ftypSize + moovSize;

    const bytes = Buffer.alloc(totalSize);

    bytes.writeUInt32BE(ftypSize, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    const moovOffset = ftypSize;
    bytes.writeUInt32BE(moovSize, moovOffset);
    bytes.write("moov", moovOffset + 4, "ascii");

    const mvhdOffset = moovOffset + 8;
    const mvhdSize = moovSize - 8;
    bytes.writeUInt32BE(mvhdSize, mvhdOffset);
    bytes.write("mvhd", mvhdOffset + 4, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });
});
