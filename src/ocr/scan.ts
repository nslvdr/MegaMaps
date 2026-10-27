import { t } from "../i18n";
import { TILE_SIZE, type ImportProgress } from "../types";
import { OcrTileCache } from "./tiles";
import { addOcrLine, OCR_VERSION, type OcrIndex, type OcrLine } from "./index";
import { regionPoint, type TextRegion } from "./regions";
import type { LineImage, LineReading } from "./recognizer";

/** The recognizer reads lines this many pixels tall. Kept here, not beside the
 * recognizer, so the page doesn't load ONNX Runtime just for this number. */
export const LINE_HEIGHT = 48;

export const OCR_WINDOW = 1024;
export const OCR_OVERLAP = 256;
// Longer lines are squeezed rather than overflowing the recognizer.
const MAX_LINE_WIDTH = 3200;
const ORIENTATION_BATCH = 32;
// The orientation classifier is right whenever it is this sure; otherwise a
// line is read both ways and the more confident reading wins.
const SURE = 0.95;
export interface OcrCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OcrEngine {
  detect(image: OffscreenCanvas): Promise<TextRegion[]>;
  recognize(line: LineImage): Promise<LineReading>;
  upsideDown(lines: LineImage[]): Promise<number[]>;
}

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

// Each label belongs to the one section whose middle holds its centre, so it is
// read once and, up to the overlap's length, never cut by a section edge. The
// small margin keeps a label on the seam from being owned by neither.
export function ownsRegion(
  crop: OcrCrop,
  map: { width: number; height: number },
  region: TextRegion,
) {
  const margin = OCR_OVERLAP / 2 - 4;
  const { x, y } = region.center;
  return (
    (crop.x === 0 || x >= margin) &&
    (crop.y === 0 || y >= margin) &&
    (crop.x + crop.width >= map.width || x < crop.width - margin) &&
    (crop.y + crop.height >= map.height || y < crop.height - margin)
  );
}

export interface LineSize {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

// Map a point in a straightened label back through its orientation and map section.
export function labelPoint(
  x: number,
  y: number,
  region: TextRegion,
  crop: OcrCrop,
  size: LineSize,
  reversed: boolean,
) {
  const direction = reversed ? -1 : 1;
  const point = regionPoint(
    region,
    (direction * (x - size.width / 2)) / size.scaleX,
    (direction * (y - size.height / 2)) / size.scaleY,
  );
  return { x: point.x + crop.x, y: point.y + crop.y };
}

export function lineSize(region: TextRegion): LineSize {
  const scaleY = LINE_HEIGHT / region.height;
  const width = Math.max(
    LINE_HEIGHT / 4,
    Math.min(MAX_LINE_WIDTH, Math.ceil(region.width * scaleY)),
  );
  return { width, height: LINE_HEIGHT, scaleX: width / region.width, scaleY };
}

// Straighten one oriented label to a recognizer line.
function straighten(
  canvas: OffscreenCanvas,
  source: OffscreenCanvas,
  region: TextRegion,
  size: LineSize,
): LineImage {
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(size.width / 2, size.height / 2);
  ctx.scale(size.scaleX, size.scaleY);
  ctx.rotate(-region.angle);
  ctx.drawImage(source, -region.center.x, -region.center.y);
  return {
    pixels: ctx.getImageData(0, 0, size.width, size.height).data,
    width: size.width,
  };
}

// Turning a line half a turn is reversing its pixels.
function turned(line: LineImage): LineImage {
  const pixels = new Uint8ClampedArray(line.pixels.length);
  const count = line.pixels.length / 4;
  for (let i = 0; i < count; i++)
    pixels.set(line.pixels.subarray(i * 4, i * 4 + 4), (count - 1 - i) * 4);
  return { pixels, width: line.width };
}

// Assemble a map section from cached tiles, columns in order so the cache
// retains the next section's shared edge.
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
        signal.throwIfAborted();
        const bitmap = await tiles.get(x, y);
        signal.throwIfAborted();
        ctx.drawImage(bitmap, x * TILE_SIZE - crop.x, y * TILE_SIZE - crop.y);
      }
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 1;
    throw error;
  }
}

// Find every label in one section, then read each one upright.
export async function scanSection(
  map: { width: number; height: number },
  tiles: OcrTileCache,
  crop: OcrCrop,
  engine: OcrEngine,
  signal: AbortSignal,
  onProgress: (fraction: number) => void = () => {},
): Promise<OcrLine[]> {
  const source = await readCrop(tiles, crop, signal);
  const scratch = new OffscreenCanvas(1, 1);
  try {
    const regions = (await engine.detect(source)).filter((region) =>
      ownsRegion(crop, map, region),
    );
    signal.throwIfAborted();
    onProgress(0.5);
    const sizes = regions.map(lineSize);
    const images = regions.map((region, i) =>
      straighten(scratch, source, region, sizes[i]!),
    );
    const upside: number[] = [];
    for (let i = 0; i < images.length; i += ORIENTATION_BATCH)
      upside.push(
        ...(await engine.upsideDown(images.slice(i, i + ORIENTATION_BATCH))),
      );
    const readings: LineReading[] = [],
      flipped: boolean[] = [];
    for (const [i, image] of images.entries()) {
      signal.throwIfAborted();
      flipped[i] = upside[i]! > 0.5;
      readings[i] = await engine.recognize(flipped[i] ? turned(image) : image);
      if (Math.max(upside[i]!, 1 - upside[i]!) < SURE) {
        const other = await engine.recognize(flipped[i] ? image : turned(image));
        if (other.confidence > readings[i]!.confidence) {
          readings[i] = other;
          flipped[i] = !flipped[i];
        }
      }
      onProgress(0.5 + (0.5 * (i + 1)) / images.length);
    }
    const lines: OcrLine[] = [];
    readings.forEach((reading, i) => {
      if (reading.confidence < 0.5) return;
      const words = reading.words
        .filter((word) => /[\p{L}\p{N}]/u.test(word.text))
        .map((word) => ({
          text: word.text,
          polygon: [
            [word.x0, 0],
            [word.x1, 0],
            [word.x1, LINE_HEIGHT],
            [word.x0, LINE_HEIGHT],
          ].map(([x, y]) =>
            labelPoint(x!, y!, regions[i]!, crop, sizes[i]!, flipped[i]!),
          ),
        }));
      if (words.length)
        lines.push({
          text: words.map((word) => word.text).join(" "),
          confidence: Math.round(reading.confidence * 100),
          words,
        });
    });
    return lines;
  } finally {
    source.width = source.height = 1;
    scratch.width = scratch.height = 1;
  }
}

export type SectionScanner = (
  section: number,
  onPart: (fraction: number) => void,
) => Promise<OcrLine[]>;

// Each scanner takes the next section as soon as it is free; the sections'
// lines are merged in map order, so the index does not depend on timing.
export async function scanMap(
  map: { id: string; width: number; height: number },
  scanners: SectionScanner[],
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal,
): Promise<OcrIndex> {
  const crops = ocrCrops(map.width, map.height);
  const parts = crops.map(() => 0);
  const sections: OcrLine[][] = [];
  const report = (section: number, part: number) => {
    parts[section] = part;
    const fraction = parts.reduce((sum, done) => sum + done) / crops.length;
    onProgress({
      fraction,
      message: t("Finding text · {percent}%", { percent: Math.floor(fraction * 100) }),
    });
  };
  let next = 0,
    failed = false;
  await Promise.all(
    scanners.map(async (scan) => {
      try {
        while (!failed && next < crops.length) {
          signal.throwIfAborted();
          const section = next++;
          sections[section] = await scan(section, (part) =>
            report(section, part),
          );
          report(section, 1);
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  );
  signal.throwIfAborted();
  const index: OcrIndex = {
    mapId: map.id,
    version: OCR_VERSION,
    completedAt: Date.now(),
    lines: [],
  };
  for (const lines of sections)
    for (const line of lines) addOcrLine(index.lines, line);
  return index;
}
