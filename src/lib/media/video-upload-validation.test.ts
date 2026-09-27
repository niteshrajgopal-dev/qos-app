import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  validateVideoUploadBytes,
  VideoUploadValidationError,
} from "./video-upload-validation";

function loadFixture(filename: string): Buffer {
  return readFileSync(
    path.join(__dirname, "../../..", "test-fixtures", "video", filename),
  );
}

describe("validateVideoUploadBytes", () => {
  test("accepts real H.264 MP4 with audio track first", () => {
    const bytes = loadFixture("audio-first.mp4");
    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("accepts real H.264 MP4 with video track first", () => {
    const bytes = loadFixture("valid-h264-audio-first.mp4");
    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("rejects ProRes MOV renamed to .mp4", () => {
    const bytes = loadFixture("prores.mov");
    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      "Only MP4 video uploads are supported.",
    );
  });

  test("rejects non-video file", () => {
    const bytes = loadFixture("not-a-video.txt");
    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      VideoUploadValidationError,
    );
    expect(() => validateVideoUploadBytes(bytes)).toThrow(
      "Only MP4 video uploads are supported.",
    );
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

  test("accepts MP4 when moov is not found in first 100KB", () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(32, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");

    expect(() => validateVideoUploadBytes(bytes)).not.toThrow();
  });

  test("accepts MP4 when video track stsd is not reachable", () => {
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
