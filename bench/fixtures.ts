import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEV_DATA_FOLDER } from "../scripts/dev-data";
import { readBackup, type BackupMap } from "../src/storage/backup";
import type { OcrLine } from "../src/ocr/index";
import { hasInk } from "../src/ocr/regions";
import { ocrCrops } from "../src/ocr/scan";
import type { MapMarker } from "../src/viewer/navigation";
import type { Point } from "../src/viewer/camera";

/** A map image the bench imports, with the places and printed names it shows. */
export interface Fixture {
  image: string;
  markers: MapMarker[];
  lines: OcrLine[];
  metresPerPixel?: number;
}
export interface Fixtures {
  /** Where the maps come from, for the report. */
  source: string;
  /** Imported, then opened and moved around. */
  map: Fixture;
  /** Scanned for text: a part of a map dense with names. */
  text: Fixture;
  /** Scanned for text too: a part with sections of blank paper, which detection skips. */
  paper?: Fixture & { blank: number; sections: number };
}

/** 16 megapixels: a realistic import that still runs many times in a few minutes. */
const MAP_SIZE = 4096;
/** Nine OCR sections. */
const TEXT_SIZE = 2048;
/** Bump when the crops change, so cached fixtures are made again. */
const VERSION = 2;
/** The grid crops are chosen on; OCR sections start on it too. */
const BLOCK = 256;
/** A section within this many levels in every channel is blank, as in src/ocr/regions.ts. */
const INK_CONTRAST = 32;

interface Area { x: number; y: number; width: number; height: number }
const inside = ({ x, y }: Point, area: Area) =>
  x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height;
const lineCentre = (line: OcrLine): Point => {
  const points = line.words.flatMap((word) => word.polygon);
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
};

/** The square of this size, on the block grid, that holds the most points. */
function busiest(size: number, width: number, height: number, points: Point[]): Area {
  const side = { width: Math.min(size, width), height: Math.min(size, height) };
  let best = { x: 0, y: 0, ...side }, most = -1;
  for (let y = 0; y + side.height <= height; y += BLOCK)
    for (let x = 0; x + side.width <= width; x += BLOCK) {
      const area = { x, y, ...side }, count = points.filter((p) => inside(p, area)).length;
      if (count > most) [best, most] = [area, count];
    }
  return best;
}

const moved = ({ x, y }: Point, area: Area) => ({ x: x - area.x, y: y - area.y });
function cropLines(lines: OcrLine[], area: Area): OcrLine[] {
  return lines
    .filter((line) => line.words.every((word) => word.polygon.every((p) => inside(p, area))))
    .map((line) => ({ ...line, words: line.words.map((word) => ({ ...word, polygon: word.polygon.map((p) => moved(p, area)) })) }));
}

async function saveCrop(image: Image, area: Area, path: string) {
  const canvas = createCanvas(area.width, area.height);
  canvas.getContext("2d").drawImage(image, -area.x, -area.y);
  await writeFile(path, await canvas.encode("jpeg", 90));
}

function fromScan(image: Image, entry: BackupMap, size: number, points: (entry: BackupMap) => Point[]) {
  const area = busiest(size, image.width, image.height, points(entry));
  const markers = entry.navigation.markers
    .filter((marker) => inside(marker.point, area))
    .map(({ photos: _, ...marker }) => ({ ...marker, point: moved(marker.point, area) }));
  return {
    area,
    fixture: (path: string): Fixture => ({
      image: path,
      markers,
      lines: cropLines(entry.ocr?.lines ?? [], area),
      ...(entry.navigation.metresPerPixel ? { metresPerPixel: entry.navigation.metresPerPixel } : {}),
    }),
  };
}

/** Each block's lowest and highest level in each colour channel. */
function blockLevels(image: Image) {
  const cols = Math.ceil(image.width / BLOCK), rows = Math.ceil(image.height / BLOCK);
  const low = new Uint8Array(cols * rows * 3).fill(255), high = new Uint8Array(cols * rows * 3);
  const band = createCanvas(image.width, BLOCK), ctx = band.getContext("2d");
  for (let row = 0; row < rows; row++) {
    const height = Math.min(BLOCK, image.height - row * BLOCK);
    ctx.drawImage(image, 0, -row * BLOCK);
    const { data } = ctx.getImageData(0, 0, image.width, height);
    for (let i = 0; i < data.length; i += 4) {
      const block = (row * cols + Math.floor((i / 4) % image.width / BLOCK)) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const value = data[i + channel]!;
        if (value < low[block + channel]!) low[block + channel] = value;
        if (value > high[block + channel]!) high[block + channel] = value;
      }
    }
  }
  return { cols, low, high };
}

/** The text-sized square with the most blank sections that still holds
 * three or more sections of print, and the most names among equals. */
function paperArea(image: Image, lines: OcrLine[]) {
  if (image.width < TEXT_SIZE || image.height < TEXT_SIZE) return;
  const { cols, low, high } = blockLevels(image);
  const sections = ocrCrops(TEXT_SIZE, TEXT_SIZE), centres = lines.map(lineCentre);
  const blank = (x: number, y: number, width: number, height: number) => {
    for (let channel = 0; channel < 3; channel++) {
      let lowest = 255, highest = 0;
      for (let by = y; by < y + Math.ceil(height / BLOCK); by++)
        for (let bx = x; bx < x + Math.ceil(width / BLOCK); bx++) {
          lowest = Math.min(lowest, low[(by * cols + bx) * 3 + channel]!);
          highest = Math.max(highest, high[(by * cols + bx) * 3 + channel]!);
        }
      if (highest - lowest >= INK_CONTRAST) return false;
    }
    return true;
  };
  let best: { area: Area; blank: number; names: number } | undefined;
  for (let y = 0; y + TEXT_SIZE <= image.height; y += BLOCK)
    for (let x = 0; x + TEXT_SIZE <= image.width; x += BLOCK) {
      const count = sections.filter((s) => blank((x + s.x) / BLOCK, (y + s.y) / BLOCK, s.width, s.height)).length;
      if (count === 0 || sections.length - count < 3) continue;
      const area = { x, y, width: TEXT_SIZE, height: TEXT_SIZE };
      const names = centres.filter((p) => inside(p, area)).length;
      if (!best || count > best.blank || (count === best.blank && names > best.names)) best = { area, blank: count, names };
    }
  return best;
}

/** Saves the paper crop, counting its blank sections as text detection will. */
async function savePaper(image: Image, entry: { lines: OcrLine[] }, area: Area, path: string) {
  const canvas = createCanvas(area.width, area.height), ctx = canvas.getContext("2d");
  ctx.drawImage(image, -area.x, -area.y);
  const sections = ocrCrops(area.width, area.height);
  const blank = sections.filter((s) => !hasInk(ctx.getImageData(s.x, s.y, s.width, s.height).data)).length;
  await writeFile(path, await canvas.encode("jpeg", 90));
  return { image: path, markers: [], lines: cropLines(entry.lines, area), blank, sections: sections.length };
}

/** Crops of the dev backup's quarry scans: the part with the most places to
 * open and move around, and the part with the most printed names to scan. */
async function fromBackup(file: string, folder: string): Promise<Fixtures> {
  const { manifest, files } = await readBackup(new Blob([await readFile(file)]));
  const scans = manifest.maps.filter((map) => !map.example && map.image.type === "image/jpeg");
  if (!scans.length) throw new Error(`${file} holds no scanned map.`);
  const most = (count: (map: BackupMap) => number) => scans.reduce((a, b) => (count(b) > count(a) ? b : a));
  const placed = most((map) => map.navigation.markers.length), named = most((map) => map.ocr?.lines.length ?? 0);
  const images = new Map<string, Image>();
  const decoded = async (entry: BackupMap) => {
    const image = images.get(entry.id) ?? await loadImage(Buffer.from(await files.get(entry.id)!.image.arrayBuffer()));
    images.set(entry.id, image);
    return image;
  };
  const mapImage = await decoded(placed);
  const map = fromScan(mapImage, placed, MAP_SIZE, (entry) => entry.navigation.markers.map((marker) => marker.point));
  await saveCrop(mapImage, map.area, join(folder, "map.jpg"));
  const textImage = await decoded(named);
  const text = fromScan(textImage, named, TEXT_SIZE, (entry) => (entry.ocr?.lines ?? []).map(lineCentre));
  await saveCrop(textImage, text.area, join(folder, "text.jpg"));
  let paper: { entry: BackupMap; image: Image; area: Area; blank: number } | undefined;
  for (const entry of scans) {
    const image = await decoded(entry), found = paperArea(image, entry.ocr?.lines ?? []);
    if (found && (!paper || found.blank > paper.blank)) paper = { entry, image, ...found };
  }
  const name = (entry: BackupMap, area: Area) => `${entry.name} ${area.width}×${area.height}`;
  return {
    source: `dev backup: ${name(placed, map.area)} map, ${name(named, text.area)} text`
      + (paper ? `, ${name(paper.entry, paper.area)} paper` : ""),
    map: map.fixture(join(folder, "map.jpg")),
    text: text.fixture(join(folder, "text.jpg")),
    ...(paper ? { paper: await savePaper(paper.image, { lines: paper.entry.ocr?.lines ?? [] }, paper.area, join(folder, "paper.jpg")) } : {}),
  };
}

/** Without a dev backup, the generated example plan stands in for both. */
async function fromExample(folder: string): Promise<Fixtures> {
  const { EXAMPLE_SCALE, exampleNavigation, exampleOcr } = await import("../src/example/example-map");
  const { PLAN_HEIGHT, PLAN_WIDTH, planMarkup } = await import("../src/example/plan");
  const width = PLAN_WIDTH * EXAMPLE_SCALE, height = PLAN_HEIGHT * EXAMPLE_SCALE;
  const plan = await loadImage(Buffer.from(planMarkup(width)));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(plan, 0, 0, width, height);
  const image = join(folder, "example.jpg");
  await writeFile(image, await canvas.encode("jpeg", 90));
  const navigation = exampleNavigation("bench"), lines = exampleOcr("bench").lines;
  const fixture: Fixture = { image, markers: navigation.markers, lines, metresPerPixel: navigation.metresPerPixel };
  const scanned = await loadImage(await readFile(image)), paper = paperArea(scanned, lines);
  return {
    source: `example plan ${width}×${height}`, map: fixture, text: fixture,
    ...(paper ? { paper: await savePaper(scanned, { lines }, paper.area, join(folder, "paper.jpg")) } : {}),
  };
}

/** Made once from the newest dev backup and kept beside the bench's other files. */
export async function prepareFixtures(cache: string): Promise<Fixtures> {
  const backups = (await readdir(DEV_DATA_FOLDER).catch(() => [])).filter((name) => name.endsWith(".megabackup")).sort();
  const backup = backups.at(-1);
  const folder = join(cache, "fixtures", `${VERSION}-${backup ?? "example"}`.replace(/[^\w.-]+/g, "-"));
  const description = join(folder, "fixtures.json");
  if (existsSync(description)) return JSON.parse(await readFile(description, "utf8"));
  await mkdir(folder, { recursive: true });
  console.log(backup ? `Preparing bench maps from ${backup}…` : "No dev backup: the bench uses the example plan.");
  const fixtures = backup ? await fromBackup(join(DEV_DATA_FOLDER, backup), folder) : await fromExample(folder);
  await writeFile(description, JSON.stringify(fixtures));
  return fixtures;
}
