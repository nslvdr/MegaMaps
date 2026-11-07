import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, openAsBlob, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { convert } from "../scripts/mbtiles-to-megamap";
import { fingerprint, readShare } from "../src/sharing/format";
import { worldToScreen } from "../src/viewer/camera";
import { invert, toMercator } from "../src/viewer/geo";

const SIZE = 256;
const tile = (color: string) => {
  const canvas = createCanvas(SIZE, SIZE), context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, SIZE, SIZE);
  return canvas.toBuffer("image/png");
};
/** Tiles by top-down row, stored bottom-up as MBTiles does. */
function mbtiles(dir: string, tiles: { z: number; x: number; y: number; color: string }[]) {
  const path = join(dir, "atlas.mbtiles"), db = new DatabaseSync(path);
  db.exec("CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INT, tile_column INT, tile_row INT, tile_data BLOB);");
  db.exec("INSERT INTO metadata VALUES ('name', 'Atlas'), ('format', 'png')");
  const insert = db.prepare("INSERT INTO tiles VALUES (?, ?, ?, ?)");
  for (const { z, x, y, color } of tiles) insert.run(z, x, 2 ** z - 1 - y, tile(color));
  db.close();
  return path;
}
const inTemp = async (use: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "mbtiles-"));
  try { await use(dir); } finally { rmSync(dir, { recursive: true }); }
};
const Z = 19, X = 265_400, Y = 343_900;
/** A path inside tile X, Y, as lon/lat by way of Mercator. */
function pathFile(dir: string) {
  const lon = ((X + 0.25) / 2 ** Z) * 360 - 180, lat2 = ((Y + 0.75) / 2 ** Z);
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * lat2))) * 180) / Math.PI;
  const path = join(dir, "path.geojson");
  writeFileSync(path, JSON.stringify({ type: "LineString", coordinates: [[lon, lat], [lon + 1e-5, lat]] }));
  return { path, lon, lat };
}

test("the crop becomes a calibrated map that imports, with what's beyond it left out", () => inTemp(async (dir) => {
  const { path, lon, lat } = pathFile(dir);
  const input = mbtiles(dir, [
    { z: Z, x: X, y: Y, color: "#ff0000" },
    { z: Z, x: X + 1, y: Y + 1, color: "#0000ff" },
    { z: Z, x: X + 50, y: Y + 50, color: "#00ff00" },
  ]);
  const output = join(dir, "out.megamap");
  // 40 m of margin at 0.2 m per pixel reaches the next tile, not the far one.
  const result = await convert({ input, around: path, margin: 40, output });
  assert.equal(result.zoom, Z);
  const share = await readShare(await openAsBlob(output));
  const { map, calibration } = share.manifest;
  assert.deepEqual([map.width, map.height], [SIZE * 2, SIZE * 2], "the far tile isn't in it");
  assert.equal(await fingerprint(share.image!), map.fingerprint);

  // The path's coordinates land on the same spot of the red tile.
  const image = await loadImage(Buffer.from(await share.image!.arrayBuffer()));
  const at = worldToScreen(invert(calibration!.geo!), toMercator({ lon, lat }));
  assert.ok(Math.abs(at.x - SIZE * 0.25) < 1e-3 && Math.abs(at.y - SIZE * 0.75) < 1e-3, `${at.x}, ${at.y}`);
  assert.ok(Math.abs(calibration!.metresPerPixel! - 0.196) < 0.01);

  const canvas = createCanvas(SIZE * 2, SIZE * 2), context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  assert.deepEqual(pixel(10, 10), [255, 0, 0, 255], "top-left tile, so the rows aren't flipped");
  assert.deepEqual(pixel(SIZE + 10, SIZE + 10), [0, 0, 255, 255]);
  assert.deepEqual(pixel(SIZE + 10, 10), [255, 255, 255, 255], "no tile here: white");
}));

test("without a zoom it takes the sharpest that fits a map, and with one it says why it can't", () => inTemp(async (dir) => {
  const input = mbtiles(dir, [
    { z: 18, x: 0, y: 0, color: "#ff0000" },
    { z: 18, x: 200, y: 200, color: "#ff0000" },
    { z: 10, x: 512, y: 300, color: "#00ff00" },
  ]);
  const output = join(dir, "out.megamap");
  const lines: string[] = [];
  const result = await convert({ input, output, log: (line) => lines.push(line) });
  assert.equal(result.zoom, 10);
  assert.ok(lines.some((line) => /Zoom 18 would be .* Trying a lower zoom/.test(line)));
  await assert.rejects(convert({ input, output, zoom: 18 }), /Pick a lower --zoom, or crop/);
  await assert.rejects(convert({ input, output, zoom: 12 }), /No tiles at zoom 12/);
}));

test("a path away from the raster is said to be, rather than making an empty map", () => inTemp(async (dir) => {
  const { path } = pathFile(dir);
  const input = mbtiles(dir, [{ z: Z, x: 10, y: 10, color: "#ff0000" }]);
  await assert.rejects(convert({ input, around: path, output: join(dir, "out.megamap") }), /don't overlap/);
}));

test("vector tiles are refused", () => inTemp(async (dir) => {
  const input = mbtiles(dir, [{ z: 1, x: 0, y: 0, color: "#ff0000" }]);
  const db = new DatabaseSync(input);
  db.exec("UPDATE metadata SET value = 'pbf' WHERE name = 'format'");
  db.close();
  await assert.rejects(convert({ input }), /vector tiles/);
}));
