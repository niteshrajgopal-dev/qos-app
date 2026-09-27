/**
 * Lightweight upload-time video validation.
 * 
 * Inspects ISO-BMFF file format headers to reject obvious non-MP4 files
 * before queueing a job. The worker validation remains the backstop.
 */

export class VideoUploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoUploadValidationError";
  }
}

const FTYP_ATOM = Buffer.from("ftyp", "ascii");
const MOOV_ATOM = Buffer.from("moov", "ascii");
const STSD_ATOM = Buffer.from("stsd", "ascii");
const AVC1_CODEC = Buffer.from("avc1", "ascii");
const HVC1_CODEC = Buffer.from("hvc1", "ascii");
const HEV1_CODEC = Buffer.from("hev1", "ascii");

const DISALLOWED_BRANDS = [
  Buffer.from("qt  ", "ascii"),
  Buffer.from("qtif", "ascii"),
];

const MAX_MOOV_SEARCH_BYTES = 100_000;

function readU32BE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

function atomAt(buffer: Buffer, offset: number): { size: number; type: Buffer } | null {
  if (offset + 8 > buffer.length) {
    return null;
  }

  const size = readU32BE(buffer, offset);
  const type = buffer.subarray(offset + 4, offset + 8);

  if (size < 8 || size > buffer.length - offset) {
    return null;
  }

  return { size, type };
}

export function validateVideoUploadBytes(bytes: Buffer): void {
  if (bytes.length < 8) {
    throw new VideoUploadValidationError(
      "Only MP4 video uploads are supported.",
    );
  }

  const firstAtom = atomAt(bytes, 0);
  if (!firstAtom || !firstAtom.type.equals(FTYP_ATOM)) {
    throw new VideoUploadValidationError(
      "Only MP4 video uploads are supported.",
    );
  }

  if (firstAtom.size < 16) {
    throw new VideoUploadValidationError(
      "Only MP4 video uploads are supported.",
    );
  }

  const majorBrand = bytes.subarray(8, 12);
  for (const disallowed of DISALLOWED_BRANDS) {
    if (majorBrand.equals(disallowed)) {
      throw new VideoUploadValidationError(
        "Only MP4 video uploads are supported.",
      );
    }
  }

  let moovOffset: number | null = null;
  let offset = firstAtom.size;

  while (offset < Math.min(bytes.length, MAX_MOOV_SEARCH_BYTES)) {
    const atom = atomAt(bytes, offset);
    if (!atom) {
      break;
    }

    if (atom.type.equals(MOOV_ATOM)) {
      moovOffset = offset;
      break;
    }

    offset += atom.size;
  }

  if (moovOffset === null) {
    return;
  }

  let stsdOffset: number | null = null;
  let moovInnerOffset = moovOffset + 8;
  const moovEndOffset = moovOffset + readU32BE(bytes, moovOffset);

  while (moovInnerOffset + 8 < Math.min(moovEndOffset, bytes.length)) {
    const atom = atomAt(bytes, moovInnerOffset);
    if (!atom) {
      break;
    }

    if (atom.type.equals(Buffer.from("trak", "ascii"))) {
      const trakEndOffset = moovInnerOffset + atom.size;
      let trakInnerOffset = moovInnerOffset + 8;

      while (trakInnerOffset + 8 < Math.min(trakEndOffset, bytes.length)) {
        const trakAtom = atomAt(bytes, trakInnerOffset);
        if (!trakAtom) {
          break;
        }

        if (trakAtom.type.equals(Buffer.from("mdia", "ascii"))) {
          const mdiaEndOffset = trakInnerOffset + trakAtom.size;
          let mdiaInnerOffset = trakInnerOffset + 8;

          while (mdiaInnerOffset + 8 < Math.min(mdiaEndOffset, bytes.length)) {
            const mdiaAtom = atomAt(bytes, mdiaInnerOffset);
            if (!mdiaAtom) {
              break;
            }

            if (mdiaAtom.type.equals(Buffer.from("minf", "ascii"))) {
              const minfEndOffset = mdiaInnerOffset + mdiaAtom.size;
              let minfInnerOffset = mdiaInnerOffset + 8;

              while (minfInnerOffset + 8 < Math.min(minfEndOffset, bytes.length)) {
                const minfAtom = atomAt(bytes, minfInnerOffset);
                if (!minfAtom) {
                  break;
                }

                if (minfAtom.type.equals(Buffer.from("stbl", "ascii"))) {
                  const stblEndOffset = minfInnerOffset + minfAtom.size;
                  let stblInnerOffset = minfInnerOffset + 8;

                  while (stblInnerOffset + 8 < Math.min(stblEndOffset, bytes.length)) {
                    const stblAtom = atomAt(bytes, stblInnerOffset);
                    if (!stblAtom) {
                      break;
                    }

                    if (stblAtom.type.equals(STSD_ATOM)) {
                      stsdOffset = stblInnerOffset;
                      break;
                    }

                    stblInnerOffset += stblAtom.size;
                  }
                }

                if (stsdOffset !== null) {
                  break;
                }

                minfInnerOffset += minfAtom.size;
              }
            }

            if (stsdOffset !== null) {
              break;
            }

            mdiaInnerOffset += mdiaAtom.size;
          }
        }

        if (stsdOffset !== null) {
          break;
        }

        trakInnerOffset += trakAtom.size;
      }
    }

    if (stsdOffset !== null) {
      break;
    }

    moovInnerOffset += atom.size;
  }

  if (stsdOffset === null || stsdOffset + 16 >= bytes.length) {
    return;
  }

  const stsdEntryOffset = stsdOffset + 16;
  if (stsdEntryOffset + 8 > bytes.length) {
    return;
  }

  const codecType = bytes.subarray(stsdEntryOffset, stsdEntryOffset + 4);

  if (
    !codecType.equals(AVC1_CODEC) &&
    !codecType.equals(HVC1_CODEC) &&
    !codecType.equals(HEV1_CODEC)
  ) {
    throw new VideoUploadValidationError(
      "Only MP4 video uploads are supported.",
    );
  }
}
