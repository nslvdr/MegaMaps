import { t } from "../i18n";
import { MAX_FILE_BYTES, MAX_PIXELS, type ImageHeader } from "../types";
const text = (bytes: Uint8Array, start: number, count: number) =>
  String.fromCharCode(...bytes.subarray(start, start + count));
function exifOrientation(data: Uint8Array): number {
  if (text(data, 0, 6) !== "Exif\0\0") return 1;
  const v = new DataView(data.buffer, data.byteOffset + 6, data.byteLength - 6);
  const little = v.getUint16(0) === 0x4949;
  if ((!little && v.getUint16(0) !== 0x4d4d) || v.getUint16(2, little) !== 42)
    return 1;
  const offset = v.getUint32(4, little);
  if (offset + 2 > v.byteLength) return 1;
  const count = v.getUint16(offset, little);
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12;
    if (p + 12 > v.byteLength) break;
    if (v.getUint16(p, little) === 0x112) {
      const value = v.getUint16(p + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
// Read container headers without decoding pixels or loading the whole original.
export async function readHeader(file: Blob): Promise<ImageHeader> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error(t("This version supports files up to 256 MB."));
  const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const v = new DataView(b.buffer);
  let header: ImageHeader;
  if (
    b[0] === 137 &&
    text(b, 1, 7) === "PNG\r\n\x1a\n" &&
    text(b, 12, 4) === "IHDR"
  ) {
    header = {
      width: v.getUint32(16),
      height: v.getUint32(20),
      format: "png",
      orientation: 1,
    };
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2,
      orientation = 1,
      found: ImageHeader | undefined;
    // JPEG segments have at most 64 KB each; don't assume SOF is in the first chunk.
    while (p < file.size) {
      const marker = new Uint8Array(await file.slice(p, p + 4).arrayBuffer());
      if (marker[0] !== 0xff) throw new Error(t("Invalid JPEG marker."));
      if (marker[1] === 0xff) {
        p++;
        continue;
      }
      const code = marker[1]!;
      if (code === 0xda || code === 0xd9) break;
      if (code === 0x01 || (code >= 0xd0 && code <= 0xd8)) {
        p += 2;
        continue;
      }
      if (marker.length < 4) throw new Error(t("Truncated JPEG header."));
      const length = (marker[2]! << 8) | marker[3]!;
      if (length < 2 || p + 2 + length > file.size)
        throw new Error(t("Invalid JPEG segment."));
      if (code === 0xe1) {
        const segment = new Uint8Array(
          await file.slice(p + 4, p + 2 + length).arrayBuffer(),
        );
        if (segment.length >= 14) orientation = exifOrientation(segment);
      }
      if ([0xc0, 0xc1, 0xc2].includes(code)) {
        const info = new DataView(await file.slice(p + 4, p + 9).arrayBuffer());
        found = {
          height: info.getUint16(1),
          width: info.getUint16(3),
          format: "jpeg",
          progressive: code === 0xc2,
          orientation,
        };
      }
      p += 2 + length;
    }
    if (!found) throw new Error(t("Unsupported or invalid JPEG."));
    header = { ...found, orientation };
  } else if (text(b, 0, 4) === "RIFF" && text(b, 8, 4) === "WEBP") {
    const kind = text(b, 12, 4);
    if (kind === "VP8X" && b[20]! & 2)
      throw new Error(t("Animated WebP is not supported. Choose a still image."));
    if (kind === "VP8X")
      header = {
        width: 1 + b[24]! + (b[25]! << 8) + (b[26]! << 16),
        height: 1 + b[27]! + (b[28]! << 8) + (b[29]! << 16),
        format: "webp",
        orientation: 1,
      };
    else if (kind === "VP8L" && b[20] === 0x2f) {
      const packed = v.getUint32(21, true);
      header = {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
        format: "webp",
        orientation: 1,
      };
    } else if (
      kind === "VP8 " &&
      b[23] === 0x9d &&
      b[24] === 0x01 &&
      b[25] === 0x2a
    ) {
      header = {
        width: v.getUint16(26, true) & 0x3fff,
        height: v.getUint16(28, true) & 0x3fff,
        format: "webp",
        orientation: 1,
      };
    } else throw new Error(t("Unsupported WebP header."));
  } else throw new Error(t("Choose a JPEG, PNG, or WebP image."));
  if (
    !header.width ||
    !header.height ||
    header.width * header.height > MAX_PIXELS ||
    Math.max(header.width, header.height) > 32768
  )
    throw new Error(
      t("Image exceeds the 600 megapixel / 32,768 pixel per side limit."),
    );
  return header;
}
