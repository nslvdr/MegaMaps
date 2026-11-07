// Turns a raster .mbtiles into a .megamap the app can import, already calibrated.
// A map holds 600 megapixels at most, so crop to what you need:
//   npm run mbtiles -- atlas.mbtiles --around galleries.gpkg
//   npm run mbtiles -- atlas.mbtiles --around galleries.gpkg --margin 300 --zoom 18 -o out.megamap
// Needs Node 22.13+, for node:sqlite and zlib.crc32.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { crc32, createDeflate } from "node:zlib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { MAX_FILE_BYTES, MAX_PIXELS, MAX_SIDE } from "../src/types";
import { geoMetresPerPixel, toLonLat } from "../src/viewer/geo";
import { readVectorFile } from "../src/vectors/layer";

const MAGIC = "MEGAMAP1";
export interface ConvertOptions {
  input: string;
  /** Crop around the lines of this GeoPackage or GeoJSON file. */
  around?: string;
  /** Metres kept around those lines. */
  margin?: number;
  /** The zoom to read; by default the sharpest whose crop fits a map. */
  zoom?: number;
  output?: string;
  log?: (line: string) => void;
}
/** A range of tiles, in the top-down numbering; `tile_row` in MBTiles counts from the bottom. */
interface Range { left: number; top: number; right: number; bottom: number }
interface Box { west: number; north: number; east: number; south: number }

/** The lines' extent in Mercator, grown by a margin in metres. */
function aroundBox(path: string, margin: number): Box {
  const { lines } = readVectorFile(readFileSync(path), basename(path), "crop");
  const box: Box = { west: Infinity, north: Infinity, east: -Infinity, south: -Infinity };
  for (const line of lines)
    for (let i = 0; i < line.length; i += 2) {
      box.west = Math.min(box.west, line[i]!);
      box.east = Math.max(box.east, line[i]!);
      box.north = Math.min(box.north, line[i + 1]!);
      box.south = Math.max(box.south, line[i + 1]!);
    }
  const { lat } = toLonLat({ x: (box.west + box.east) / 2, y: (box.north + box.south) / 2 });
  const grow = margin / (40_075_016.686 * Math.cos((lat * Math.PI) / 180));
  return { west: box.west - grow, north: box.north - grow, east: box.east + grow, south: box.south + grow };
}
/** The tiles that exist at this zoom within the crop, trimmed of empty edges. */
function tileRange(db: DatabaseSync, zoom: number, box?: Box): Range | undefined {
  const n = 2 ** zoom, last = n - 1;
  const wanted = box
    ? { left: Math.floor(box.west * n), right: Math.floor(box.east * n), top: Math.floor(box.north * n), bottom: Math.floor(box.south * n) }
    : { left: 0, right: last, top: 0, bottom: last };
  const row = db.prepare(`SELECT min(tile_column) left_, max(tile_column) right_, min(tile_row) low, max(tile_row) high FROM tiles
    WHERE zoom_level = ? AND tile_column BETWEEN ? AND ? AND tile_row BETWEEN ? AND ?`)
    .get(zoom, wanted.left, wanted.right, last - wanted.bottom, last - wanted.top) as Record<string, number | null> | undefined;
  if (row?.left_ == null) return undefined;
  return { left: row.left_, right: row.right_!, top: last - row.high!, bottom: last - row.low! };
}
const fits = (width: number, height: number) => width <= MAX_SIDE && height <= MAX_SIDE && width * height <= MAX_PIXELS;

const pngChunk = (kind: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(kind, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
/** Writes the tiles as one PNG, a row of tiles at a time, so the picture is never
 * whole in memory. Parts without tiles, and transparency, become white. */
async function writePng(db: DatabaseSync, zoom: number, range: Range, tileSize: number, path: string, log: (line: string) => void) {
  const columns = range.right - range.left + 1, rows = range.bottom - range.top + 1,
    width = columns * tileSize, height = rows * tileSize, last = 2 ** zoom - 1;
  const file = createWriteStream(path);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  file.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  file.write(pngChunk("IHDR", header));
  const deflate = createDeflate({ level: 9 });
  const written = (async () => {
    for await (const chunk of deflate) if (!file.write(pngChunk("IDAT", chunk as Buffer))) await new Promise<void>((done) => file.once("drain", () => done()));
  })();
  const select = db.prepare("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?");
  const canvas = createCanvas(tileSize, tileSize), context = canvas.getContext("2d");
  const stride = width * 3;
  const band = new Uint8Array(stride * tileSize);
  let previous = new Uint8Array(stride);
  for (let row = 0; row < rows; row++) {
    band.fill(255);
    for (let column = 0; column < columns; column++) {
      const tile = select.get(zoom, range.left + column, last - (range.top + row)) as { tile_data: Uint8Array } | undefined;
      if (!tile) continue;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, tileSize, tileSize);
      context.drawImage(await loadImage(Buffer.from(tile.tile_data)), 0, 0, tileSize, tileSize);
      const rgba = context.getImageData(0, 0, tileSize, tileSize).data;
      for (let y = 0; y < tileSize; y++) {
        let to = y * stride + column * tileSize * 3;
        for (let x = 0, from = y * tileSize * 4; x < tileSize; x++, from += 4) {
          band[to++] = rgba[from]!;
          band[to++] = rgba[from + 1]!;
          band[to++] = rgba[from + 2]!;
        }
      }
    }
    for (let y = 0; y < tileSize; y++) {
      // Filter "Up": flat-coloured plans shrink well against the row above.
      const line = new Uint8Array(stride + 1);
      line[0] = 2;
      const current = band.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < stride; x++) line[x + 1] = current[x]! - previous[x]!;
      previous = current.slice();
      if (!deflate.write(line)) await new Promise<void>((done) => deflate.once("drain", () => done()));
    }
    log(`  row ${row + 1} / ${rows}`);
  }
  deflate.end();
  await written;
  file.write(pngChunk("IEND", new Uint8Array()));
  await new Promise<void>((done, fail) => file.end((error?: Error | null) => error ? fail(error) : done()));
  return { width, height };
}

/** Writes the .megamap and says what went in. */
export async function convert({ input, around, margin = 100, zoom, output, log = () => {} }: ConvertOptions) {
  const db = new DatabaseSync(input, { readOnly: true });
  try {
    const metadata = new Map((db.prepare("SELECT name, value FROM metadata").all() as { name: string; value: string }[]).map((row) => [row.name, row.value]));
    if (metadata.get("format") === "pbf") throw new Error("This .mbtiles holds vector tiles; only raster tiles can become a map.");
    const box = around ? aroundBox(around, margin) : undefined;
    const sample = db.prepare("SELECT tile_data FROM tiles LIMIT 1").get() as { tile_data: Uint8Array } | undefined;
    if (!sample) throw new Error("This .mbtiles has no tiles.");
    const tileSize = (await loadImage(Buffer.from(sample.tile_data))).width;
    const zooms = (db.prepare("SELECT DISTINCT zoom_level z FROM tiles ORDER BY z DESC").all() as { z: number }[]).map((row) => row.z);
    if (zoom !== undefined && !zooms.includes(zoom)) throw new Error(`No tiles at zoom ${zoom}. It has: ${zooms.join(", ")}.`);
    const stem = resolve(output ?? `${input.replace(/\.mbtiles$/i, "")}${around ? `-${basename(around).replace(/\.[^.]+$/, "")}` : ""}.megamap`);
    const imagePath = `${stem}.png.tmp`;
    try {
      for (const level of zoom !== undefined ? [zoom] : zooms) {
        const range = tileRange(db, level, box);
        if (!range) {
          if (box) throw new Error(`The raster has no tiles around that path at zoom ${level}: they don't overlap.`);
          continue;
        }
        const width = (range.right - range.left + 1) * tileSize, height = (range.bottom - range.top + 1) * tileSize;
        if (!fits(width, height)) {
          const message = `Zoom ${level} would be ${width} × ${height} px (${Math.round(width * height / 1e6)} MP); a map holds ${MAX_PIXELS / 1e6} MP and ${MAX_SIDE} px per side.`;
          if (zoom !== undefined) throw new Error(`${message} Pick a lower --zoom, or crop with --around.`);
          log(`${message} Trying a lower zoom.`);
          continue;
        }
        log(`Zoom ${level}: ${width} × ${height} px (${Math.round(width * height / 1e6)} MP)`);
        await writePng(db, level, range, tileSize, imagePath, log);
        const bytes = statSync(imagePath).size;
        if (bytes > MAX_FILE_BYTES) {
          const message = `Zoom ${level} takes ${Math.round(bytes / 2 ** 20)} MB; a map image holds ${MAX_FILE_BYTES / 2 ** 20} MB.`;
          if (zoom !== undefined) throw new Error(`${message} Pick a lower --zoom, or crop with --around.`);
          log(`${message} Trying a lower zoom.`);
          continue;
        }
        const hash = createHash("sha256");
        await pipeline(createReadStream(imagePath), hash);
        const name = `${metadata.get("name") ?? basename(input, ".mbtiles")}${around ? ` · ${basename(around).replace(/\.[^.]+$/, "")}` : ""}`.slice(0, 200);
        const map = { name, width, height, fingerprint: hash.digest("hex") };
        // Where the map lies on Earth, so it is calibrated from the start.
        const n = 2 ** level, geo = { x: range.left / n, y: range.top / n, scale: 1 / (tileSize * n), rotation: 0 };
        const manifest = Buffer.from(JSON.stringify({
          format: "megamap", version: 6, map,
          image: { name: `${basename(stem, ".megamap")}.png`, type: "image/png", bytes },
          markers: [], routes: [],
          calibration: { geo, metresPerPixel: geoMetresPerPixel(geo, map) },
        }));
        const head = Buffer.alloc(12);
        head.write(MAGIC, 0, "latin1");
        head.writeUInt32LE(manifest.length, 8);
        const out = createWriteStream(stem);
        out.write(head);
        out.write(manifest);
        await pipeline(createReadStream(imagePath), out);
        log(`${stem}: ${Math.round(statSync(stem).size / 2 ** 20)} MB, ${geoMetresPerPixel(geo, map).toFixed(2)} m per pixel`);
        return { path: stem, zoom: level, width, height, bytes };
      }
      throw new Error("Nothing fits a map at any zoom. Crop with --around.");
    } finally {
      rmSync(imagePath, { force: true });
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    around: { type: "string" }, margin: { type: "string" }, zoom: { type: "string" }, output: { type: "string", short: "o" },
  } });
  if (positionals.length !== 1) {
    console.error("Usage: npm run mbtiles -- input.mbtiles [--around path.gpkg] [--margin metres] [--zoom n] [-o out.megamap]");
    process.exit(2);
  }
  convert({
    input: positionals[0]!, around: values.around, output: values.output, log: console.log,
    ...(values.margin ? { margin: Number(values.margin) } : {}), ...(values.zoom ? { zoom: Number(values.zoom) } : {}),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
