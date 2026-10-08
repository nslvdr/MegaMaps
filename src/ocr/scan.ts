import type { Page } from "tesseract.js";
import { TILE_SIZE, type MapRecord, type ImportProgress } from "../types";
import type { PayloadStore } from "../storage/payloads";
import { OcrTileCache } from "./tiles";
import { addOcrLine, OCR_VERSION, type OcrIndex, type OcrLine } from "./index";
import {
  regionPoint,
  regionPolygon,
  sameRegion,
  type TextRegion,
} from "./regions";

export const OCR_WINDOW = 1024;
export const OCR_OVERLAP = 256;
export interface OcrCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Recognizer = (
  image: Blob,
) => Promise<Pick<Page, "blocks" | "confidence">>;
export type RegionDetector = (image: OffscreenCanvas) => Promise<TextRegion[]>;

export function ocrCrops(width: number, height: number): OcrCrop[] {
  const starts = (length: number) => {
    const positions = [0];
    while (positions[positions.length - 1]! + OCR_WINDOW < length)
      positions.push(
        positions[positions.length - 1]! + OCR_WINDOW - OCR_OVERLAP,
      );
    return positions;
  };
  const crops: OcrCrop[] = [];
  for (const y of starts(height))
    for (const x of starts(width))
      crops.push({
        x,
        y,
        width: Math.min(OCR_WINDOW, width - x),
        height: Math.min(OCR_WINDOW, height - y),
      });
  return crops;
}

// Map a word in a straightened label back through its orientation and map section.
export function labelPoint(
  x: number,
  y: number,
  region: TextRegion,
  crop: OcrCrop,
  size: { width: number; height: number; scale: number },
  reversed: boolean,
) {
  const direction = reversed ? -1 : 1;
  const point = regionPoint(
    region,
    (direction * (x - size.width / 2)) / size.scale,
    (direction * (y - size.height / 2)) / size.scale,
  );
  return { x: point.x + crop.x, y: point.y + crop.y };
}

function checkAbort(signal: AbortSignal) {
  signal.throwIfAborted();
}

// Draw columns in order so the cache retains the next section's shared edge.
async function readCrop(
  tiles: OcrTileCache,
  crop: OcrCrop,
  signal: AbortSignal,
) {
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, crop.width, crop.height);
    for (
      let x = Math.floor(crop.x / TILE_SIZE);
      x < Math.ceil((crop.x + crop.width) / TILE_SIZE);
      x++
    )
      for (
        let y = Math.floor(crop.y / TILE_SIZE);
        y < Math.ceil((crop.y + crop.height) / TILE_SIZE);
        y++
      ) {
        checkAbort(signal);
        const bitmap = await tiles.get(x, y);
        checkAbort(signal);
        ctx.drawImage(bitmap, x * TILE_SIZE - crop.x, y * TILE_SIZE - crop.y);
      }
    // Grayscale and invert dark backgrounds for the text recognizer only.
    const pixels = ctx.getImageData(0, 0, crop.width, crop.height);
    let total = 0,
      count = 0;
    for (let i = 0; i < pixels.data.length; i += 64) {
      total += pixels.data[i]! + pixels.data[i + 1]! + pixels.data[i + 2]!;
      count++;
    }
    const dark = total / (count * 3) < 128;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value =
        0.299 * pixels.data[i]! +
        0.587 * pixels.data[i + 1]! +
        0.114 * pixels.data[i + 2]!;
      pixels.data[i] =
        pixels.data[i + 1] =
        pixels.data[i + 2] =
          dark ? 255 - value : value;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 1;
    throw error;
  }
}

// Read only detected, straightened labels; ambiguous reading direction needs two small passes.
export async function scanMap(
  map: MapRecord,
  store: PayloadStore,
  detect: RegionDetector,
  recognize: Recognizer,
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal,
): Promise<OcrIndex> {
  const crops = ocrCrops(map.width, map.height);
  const index: OcrIndex = {
    mapId: map.id,
    version: OCR_VERSION,
    completedAt: 0,
    lines: [],
  };
  const label = new OffscreenCanvas(1, 1);
  const tiles = new OcrTileCache(map, store, signal);
  const seen: TextRegion[] = [];
  try {
    for (const [section, crop] of crops.entries()) {
      checkAbort(signal);
      const source = await readCrop(tiles, crop, signal);
      try {
        onProgress({
          fraction: section / crops.length,
          message: `Finding text · section ${section + 1} of ${crops.length}`,
        });
        const regions = await detect(source);
        checkAbort(signal);
        for (const [position, region] of regions.entries()) {
          checkAbort(signal);
          // An overlapping section supplies complete labels clipped by an internal edge.
          const polygon = regionPolygon(region);
          if (
            polygon.some(
              (p) =>
                (crop.x > 0 && p.x < 0) ||
                (crop.y > 0 && p.y < 0) ||
                (crop.x + crop.width < map.width && p.x > crop.width) ||
                (crop.y + crop.height < map.height && p.y > crop.height),
            )
          )
            continue;
          const global = {
            ...region,
            center: {
              x: region.center.x + crop.x,
              y: region.center.y + crop.y,
            },
          };
          if (seen.some((previous) => sameRegion(previous, global))) continue;
          const scale = Math.min(
            Math.max(1, Math.min(2, 48 / region.height)),
            Math.sqrt(2_000_000 / (region.width * region.height)),
          );
          const size = {
            width: Math.max(1, Math.ceil(region.width * scale)),
            height: Math.max(1, Math.ceil(region.height * scale)),
            scale,
          };
          let best: { lines: OcrLine[]; confidence: number } | undefined;
          for (const reversed of [false, true]) {
            checkAbort(signal);
            label.width = size.width;
            label.height = size.height;
            const ctx = label.getContext("2d")!;
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, label.width, label.height);
            ctx.translate(label.width / 2, label.height / 2);
            ctx.scale(scale, scale);
            ctx.rotate(-region.angle + (reversed ? Math.PI : 0));
            ctx.drawImage(source, -region.center.x, -region.center.y);
            const data = await recognize(
              await label.convertToBlob({ type: "image/png" }),
            );
            checkAbort(signal);
            const lines: OcrLine[] = [];
            for (const block of data.blocks ?? [])
              for (const paragraph of block.paragraphs)
                for (const line of paragraph.lines) {
                  const words = line.words
                    .filter(
                      (word) =>
                        word.confidence >= 45 &&
                        /[\p{L}\p{N}]/u.test(word.text),
                    )
                    .map((word) => {
                      const b = word.bbox;
                      return {
                        text: word.text,
                        polygon: [
                          [b.x0, b.y0],
                          [b.x1, b.y0],
                          [b.x1, b.y1],
                          [b.x0, b.y1],
                        ].map(([x, y]) =>
                          labelPoint(x!, y!, region, crop, size, reversed),
                        ),
                      };
                    });
                  if (words.length)
                    lines.push({
                      text: words.map((word) => word.text).join(" "),
                      confidence: line.confidence,
                      words,
                    });
                }
            if (lines.length && (!best || data.confidence > best.confidence))
              best = { lines, confidence: data.confidence };
            // Low-confidence or empty results still try the opposite direction.
            if (
              lines.length &&
              data.confidence >= 90 &&
              (data.blocks ?? []).every((block) =>
                block.paragraphs.every((paragraph) =>
                  paragraph.lines.every((line) =>
                    line.words.every(
                      (word) =>
                        !/[\p{L}\p{N}]/u.test(word.text) ||
                        word.confidence >= 85,
                    ),
                  ),
                ),
              )
            )
              break;
          }
          if (best) {
            seen.push(global);
            for (const line of best.lines) addOcrLine(index.lines, line);
          }
          onProgress({
            fraction:
              (section + (position + 1) / Math.max(1, regions.length)) /
              crops.length,
            message: `Reading labels · section ${section + 1} of ${crops.length} · label ${position + 1} of ${regions.length}`,
          });
        }
        onProgress({
          fraction: (section + 1) / crops.length,
          message: `Text detection · ${Math.round(((section + 1) / crops.length) * 100)}%`,
        });
      } finally {
        source.width = source.height = 1;
      }
    }
    index.completedAt = Date.now();
    return index;
  } finally {
    tiles.dispose();
    label.width = label.height = 1;
  }
}
