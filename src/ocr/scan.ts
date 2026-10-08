import type { Page } from "tesseract.js";
import {
  tileKey,
  TILE_SIZE,
  type MapRecord,
  type ImportProgress,
} from "../types";
import type { PayloadStore } from "../storage/payloads";
import { addOcrLine, OCR_VERSION, type OcrIndex } from "./index";

export const OCR_WINDOW = 1536;
export const OCR_OVERLAP = 256;
// Cover a full turn, including upside-down labels and both vertical directions.
export const OCR_ANGLES = Array.from(
  { length: 24 },
  (_, i) => (i * Math.PI) / 12,
);
export interface OcrCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Recognizer = (image: Blob) => Promise<Pick<Page, "blocks">>;

export function ocrCrops(width: number, height: number): OcrCrop[] {
  const crops: OcrCrop[] = [];
  for (let y = 0; y < height; y += OCR_WINDOW - OCR_OVERLAP)
    for (let x = 0; x < width; x += OCR_WINDOW - OCR_OVERLAP)
      crops.push({
        x,
        y,
        width: Math.min(OCR_WINDOW, width - x),
        height: Math.min(OCR_WINDOW, height - y),
      });
  return crops;
}

export function rotatedSize(
  crop: Pick<OcrCrop, "width" | "height">,
  angle: number,
) {
  const c = Math.abs(Math.cos(angle)),
    s = Math.abs(Math.sin(angle));
  return {
    width: Math.ceil(c * crop.width + s * crop.height),
    height: Math.ceil(s * crop.width + c * crop.height),
  };
}

// Inverse of the padded canvas rotation: all stored polygons use original pixels.
export function ocrPoint(x: number, y: number, crop: OcrCrop, angle: number) {
  const size = rotatedSize(crop, angle),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const dx = x - size.width / 2,
    dy = y - size.height / 2;
  return {
    x: crop.x + crop.width / 2 + c * dx + s * dy,
    y: crop.y + crop.height / 2 - s * dx + c * dy,
  };
}

function checkAbort(signal: AbortSignal) {
  signal.throwIfAborted();
}

// Assemble only a bounded crop from native-resolution tiles, closing each decode.
async function readCrop(
  map: MapRecord,
  store: PayloadStore,
  crop: OcrCrop,
  signal: AbortSignal,
) {
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, crop.width, crop.height);
    for (
      let y = Math.floor(crop.y / TILE_SIZE);
      y < Math.ceil((crop.y + crop.height) / TILE_SIZE);
      y++
    )
      for (
        let x = Math.floor(crop.x / TILE_SIZE);
        x < Math.ceil((crop.x + crop.width) / TILE_SIZE);
        x++
      ) {
        checkAbort(signal);
        const bitmap = await createImageBitmap(
          await store.get(map.id, tileKey(0, x, y)),
        );
        try {
          checkAbort(signal);
          ctx.drawImage(bitmap, x * TILE_SIZE - crop.x, y * TILE_SIZE - crop.y);
        } finally {
          bitmap.close();
        }
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

// Sequential OCR bounds image memory independently of total map dimensions.
export async function scanMap(
  map: MapRecord,
  store: PayloadStore,
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
  const rotated = new OffscreenCanvas(1, 1);
  let completed = 0;
  try {
    for (const crop of crops) {
      checkAbort(signal);
      const source = await readCrop(map, store, crop, signal);
      try {
        for (const angle of OCR_ANGLES) {
          checkAbort(signal);
          const size = rotatedSize(crop, angle);
          rotated.width = size.width;
          rotated.height = size.height;
          const ctx = rotated.getContext("2d")!;
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, rotated.width, rotated.height);
          ctx.translate(rotated.width / 2, rotated.height / 2);
          ctx.rotate(angle);
          ctx.drawImage(source, -crop.width / 2, -crop.height / 2);
          const data = await recognize(
            await rotated.convertToBlob({ type: "image/png" }),
          );
          checkAbort(signal);
          for (const block of data.blocks ?? [])
            for (const paragraph of block.paragraphs)
              for (const line of paragraph.lines) {
                const words = line.words
                  .filter(
                    (word) =>
                      word.confidence >= 45 && /[\p{L}\p{N}]/u.test(word.text),
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
                      ].map(([x, y]) => ocrPoint(x!, y!, crop, angle)),
                    };
                  })
                  .filter((word) =>
                    word.polygon.every(
                      (p) =>
                        p.x >= -1 &&
                        p.y >= -1 &&
                        p.x <= map.width + 1 &&
                        p.y <= map.height + 1,
                    ),
                  );
                addOcrLine(index.lines, {
                  text: words.map((word) => word.text).join(" "),
                  confidence: line.confidence,
                  words,
                });
              }
          completed++;
          onProgress({
            fraction: completed / (crops.length * OCR_ANGLES.length),
            message: `Detecting map text · section ${Math.floor((completed - 1) / OCR_ANGLES.length) + 1} of ${crops.length} · ${Math.round((completed / (crops.length * OCR_ANGLES.length)) * 100)}%`,
          });
        }
      } finally {
        source.width = source.height = 1;
      }
    }
    index.completedAt = Date.now();
    return index;
  } finally {
    rotated.width = rotated.height = 1;
  }
}
