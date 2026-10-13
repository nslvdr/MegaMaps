import { t } from "../i18n";
import type { ImageHeader } from "../types";
export type RowConsumer = (rgba: Uint8ClampedArray, y: number) => Promise<void>;
interface PNGInfo {
  depth: number;
  color: number;
  ranges: [number, number][];
  palette?: Uint8Array;
  transparency?: Uint8Array;
}
const nameOf = (b: Uint8Array) => String.fromCharCode(...b);
export class NativePNGRequired extends Error {}
async function inspect(file: Blob): Promise<PNGInfo> {
  const header = new Uint8Array(await file.slice(24, 29).arrayBuffer());
  const depth = header[0]!,
    color = header[1]!;
  if (header[2] !== 0 || header[3] !== 0 || header[4] !== 0)
    throw new NativePNGRequired("Interlaced PNG needs the native decoder.");
  if (
    ![0, 2, 3, 4, 6].includes(color) ||
    ![1, 2, 4, 8, 16].includes(depth) ||
    (color !== 0 && color !== 3 && depth < 8) ||
    (color === 3 && depth === 16)
  )
    throw new Error(t("Unsupported PNG pixel format."));
  const info: PNGInfo = { depth, color, ranges: [] };
  for (let p = 8; p < file.size; ) {
    const chunk = new Uint8Array(await file.slice(p, p + 8).arrayBuffer());
    if (chunk.length !== 8) throw new Error(t("Truncated PNG chunk."));
    const length = new DataView(chunk.buffer).getUint32(0);
    const kind = nameOf(chunk.subarray(4));
    if (p + 12 + length > file.size) throw new Error(t("Truncated PNG data."));
    if (kind === "IDAT" && length) {
      if (info.ranges.length > 100_000)
        throw new Error(t("PNG has too many data chunks."));
      info.ranges.push([p + 8, length]);
    }
    if (kind === "PLTE" || kind === "tRNS") {
      if (length > 768) throw new Error(t("Invalid PNG palette."));
      const data = new Uint8Array(
        await file.slice(p + 8, p + 8 + length).arrayBuffer(),
      );
      if (kind === "PLTE") info.palette = data;
      else info.transparency = data;
    }
    if (kind === "acTL")
      throw new Error(t("Animated PNG is not supported. Choose a still image."));
    if (kind === "IEND") break;
    p += length + 12;
  }
  if (!info.ranges.length || (color === 3 && !info.palette))
    throw new Error(t("PNG pixel data is missing."));
  return info;
}
export function unfilter(
  row: Uint8Array,
  previous: Uint8Array,
  bpp: number,
  filter: number,
) {
  if (filter > 4) throw new Error(t("Invalid PNG row filter."));
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0,
      b = previous[i]!,
      c = i >= bpp ? previous[i - bpp]! : 0;
    let predictor = 0;
    if (filter === 1) predictor = a;
    if (filter === 2) predictor = b;
    if (filter === 3) predictor = (a + b) >>> 1;
    if (filter === 4) {
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    row[i] = (row[i]! + predictor) & 255;
  }
}
// Bounded compressed chunks matter on WebKit: it buffers each chunk's inflated output.
// Backpressure ensures only a few rows/chunks plus one tile band exist at a time.
export async function decodePNG(
  file: Blob,
  header: ImageHeader,
  consume: RowConsumer,
) {
  const info = await inspect(file);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const)[
    info.color as 0 | 2 | 3 | 4 | 6
  ];
  const rowBytes = Math.ceil((header.width * channels * info.depth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * info.depth) / 8));
  let range = 0,
    offset = 0;
  const compressed = new ReadableStream<BufferSource>({
    async pull(controller) {
      const r = info.ranges[range];
      if (!r) {
        controller.close();
        return;
      }
      const count = Math.min(4096, r[1] - offset);
      if (count)
        controller.enqueue(
          new Uint8Array(
            await file
              .slice(r[0] + offset, r[0] + offset + count)
              .arrayBuffer(),
          ),
        );
      offset += count;
      if (offset >= r[1]) {
        range++;
        offset = 0;
      }
    },
  });
  const reader = compressed
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  let chunk: Uint8Array<ArrayBufferLike> = new Uint8Array(),
    cursor = 0;
  async function fill(target: Uint8Array) {
    let written = 0;
    while (written < target.length) {
      if (cursor === chunk.length) {
        const next = await reader.read();
        if (next.done) throw new Error(t("Truncated PNG pixel stream."));
        chunk = next.value;
        cursor = 0;
      }
      const count = Math.min(target.length - written, chunk.length - cursor);
      target.set(chunk.subarray(cursor, cursor + count), written);
      written += count;
      cursor += count;
    }
  }
  let row = new Uint8Array(rowBytes),
    previous = new Uint8Array(rowBytes);
  const tag = new Uint8Array(1),
    rgba = new Uint8ClampedArray(header.width * 4);
  const max = (1 << Math.min(info.depth, 8)) - 1;
  const sample = (i: number) =>
    info.depth === 16
      ? (row[i * 2]! << 8) | row[i * 2 + 1]!
      : info.depth === 8
        ? row[i]!
        : (row[(i * info.depth) >>> 3]! >>>
            (8 - info.depth - ((i * info.depth) % 8))) &
          max;
  const colorByte = (s: number) =>
    info.depth === 16 ? s >>> 8 : Math.round((s * 255) / max);
  const transparency = info.transparency;
  const transparentSample = (i: number) =>
    transparency ? (transparency[i * 2]! << 8) | transparency[i * 2 + 1]! : -1;
  try {
    for (let y = 0; y < header.height; y++) {
      await fill(tag);
      await fill(row);
      unfilter(row, previous, bpp, tag[0]!);
      for (let x = 0; x < header.width; x++) {
        const p = x * 4,
          s = x * channels,
          a = sample(s);
        if (info.color === 3) {
          if (a * 3 + 2 >= info.palette!.length)
            throw new Error(t("Invalid PNG palette index."));
          rgba[p] = info.palette![a * 3]!;
          rgba[p + 1] = info.palette![a * 3 + 1]!;
          rgba[p + 2] = info.palette![a * 3 + 2]!;
          rgba[p + 3] = transparency?.[a] ?? 255;
        } else if (info.color === 0 || info.color === 4) {
          rgba[p] = rgba[p + 1] = rgba[p + 2] = colorByte(a);
          rgba[p + 3] =
            info.color === 4
              ? colorByte(sample(s + 1))
              : a === transparentSample(0)
                ? 0
                : 255;
        } else {
          const b = sample(s + 1),
            c = sample(s + 2);
          rgba[p] = colorByte(a);
          rgba[p + 1] = colorByte(b);
          rgba[p + 2] = colorByte(c);
          rgba[p + 3] =
            info.color === 6
              ? colorByte(sample(s + 3))
              : a === transparentSample(0) &&
                  b === transparentSample(1) &&
                  c === transparentSample(2)
                ? 0
                : 255;
        }
      }
      await consume(rgba, y);
      [row, previous] = [previous, row];
    }
    if (cursor !== chunk.length || !(await reader.read()).done)
      throw new Error(t("PNG has extra pixel data."));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
