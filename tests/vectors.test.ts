import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isVectorLayer, readVectorFile, shownLinesGeoJson } from "../src/vectors/layer";
import { normalizeNavigation } from "../src/viewer/navigation";
import { toLonLat } from "../src/viewer/geo";

/** A line as GeoPackage stores it, with an optional 32-byte envelope and either byte order. */
function geometry(points: number[][], { little = true, envelope = true, z = false } = {}) {
  const dims = z ? 3 : 2;
  const wkb = Buffer.alloc(9 + points.length * dims * 8);
  const u32 = (value: number, at: number) => little ? wkb.writeUInt32LE(value, at) : wkb.writeUInt32BE(value, at);
  const f64 = (value: number, at: number) => little ? wkb.writeDoubleLE(value, at) : wkb.writeDoubleBE(value, at);
  wkb[0] = little ? 1 : 0;
  u32(z ? 1002 : 2, 1);
  u32(points.length, 5);
  points.forEach(([x, y], i) => {
    f64(x!, 9 + i * dims * 8);
    f64(y!, 17 + i * dims * 8);
    if (z) f64(99, 25 + i * dims * 8);
  });
  const head = Buffer.alloc(8 + (envelope ? 32 : 0));
  head.write("GP", 0, "latin1");
  head[3] = (envelope ? 2 : 0) | 1;
  return Buffer.concat([head, wkb]);
}
function geoPackage(srs: [string, number], rows: Buffer[]) {
  const dir = mkdtempSync(join(tmpdir(), "gpkg-"));
  try {
    const path = join(dir, "test.gpkg"), db = new DatabaseSync(path);
    db.exec(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);
      CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z TINYINT, m TINYINT);
      CREATE TABLE lines (fid INTEGER PRIMARY KEY, name TEXT, geom BLOB);`);
    db.prepare("INSERT INTO gpkg_spatial_ref_sys VALUES ('x', 77, ?, ?, 'x', NULL)").run(...srs);
    db.exec("INSERT INTO gpkg_geometry_columns VALUES ('lines', 'geom', 'LINESTRING', 77, 0, 0)");
    const insert = db.prepare("INSERT INTO lines (name, geom) VALUES ('é', ?)");
    db.exec("BEGIN");
    for (const row of rows) insert.run(row);
    db.exec("COMMIT");
    db.close();
    return readFileSync(path);
  } finally {
    rmSync(dir, { recursive: true });
  }
}
const read = (bytes: Uint8Array) => readVectorFile(bytes, "galleries.gpkg", "id");
const paris = [[2.32, 48.82], [2.33, 48.83]];

test("a GeoPackage's lines land where they are on Earth", () => {
  const layer = read(geoPackage(["EPSG", 4326], [geometry(paris)]));
  assert.equal(layer.name, "galleries");
  const { lon, lat } = toLonLat({ x: layer.lines[0]![2]!, y: layer.lines[0]![3]! });
  assert.ok(Math.abs(lon - 2.33) < 1e-9 && Math.abs(lat - 48.83) < 1e-9);
});

test("metres read the same whether declared, or wrongly labelled as degrees as QGIS can leave them", () => {
  const metres = [[258_000, 6_245_000], [259_000, 6_245_500]];
  const declared = read(geoPackage(["EPSG", 3857], [geometry(metres)])).lines;
  assert.deepEqual(read(geoPackage(["EPSG", 4326], [geometry(metres)])).lines, declared);
  const { lon, lat } = toLonLat({ x: declared[0]![0]!, y: declared[0]![1]! });
  assert.ok(Math.abs(lon - 2.3176) < 1e-3 && Math.abs(lat - 48.82) < 0.01, `${lon}, ${lat}`);
});

test("every row is read: tables spanning many pages, and lines spilling onto overflow pages", () => {
  const long = Array.from({ length: 2000 }, (_, i) => [2.3 + i * 1e-6, 48.8]);
  const rows = Array.from({ length: 3000 }, () => geometry(paris));
  rows.splice(1500, 0, geometry(long));
  const { lines } = read(geoPackage(["EPSG", 4326], rows));
  assert.equal(lines.length, 3001);
  const big = lines.find((line) => line.length === 4000);
  assert.ok(big, "the long line came back whole");
  const { lon } = toLonLat({ x: big[3998]!, y: big[3999]! });
  assert.ok(Math.abs(lon - (2.3 + 1999e-6)) < 1e-9);
});

test("byte order, envelopes and heights don't change a line", () => {
  const plain = read(geoPackage(["EPSG", 4326], [geometry(paris)])).lines;
  for (const form of [{ little: false }, { envelope: false }, { z: true }])
    assert.deepEqual(read(geoPackage(["EPSG", 4326], [geometry(paris, form)])).lines, plain, JSON.stringify(form));
});

test("a coordinate system it can't convert is named, not guessed", () => {
  assert.throws(() => read(geoPackage(["EPSG", 2154], [geometry(paris)])), /EPSG:2154/);
  assert.throws(() => read(geoPackage(["GDAL", 99999], [geometry(paris)])), /GDAL:99999/);
});

test("a damaged file is refused with advice, not a crash", () => {
  const bytes = geoPackage(["EPSG", 4326], Array.from({ length: 500 }, () => geometry(paris)));
  assert.throws(() => read(bytes.subarray(0, bytes.length >> 1)), /could not be read/);
  assert.throws(() => read(new TextEncoder().encode("not a map")), /GeoPackage/);
});

test("GeoJSON's lines and rings are read, its points left out", () => {
  const layer = readVectorFile(new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: paris } },
    { type: "Feature", geometry: { type: "Point", coordinates: paris[0] } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[...paris, [2.32, 48.84]]] } },
    { type: "Feature", geometry: null },
  ] })), "a.geojson", "id");
  assert.deepEqual(layer.lines.map((line) => line.length), [4, 6]);
  assert.throws(() => readVectorFile(new TextEncoder().encode('{"type":"Point","coordinates":[2,48]}'), "a.geojson", "id"), /no lines/);
});

test("a saved layer survives loading, and a malformed one is dropped", () => {
  const good = { id: "a", name: "A", visible: true, lines: [[0.5, 0.3, 0.6, 0.4]] };
  assert.ok(isVectorLayer(good));
  const { vectors } = normalizeNavigation({ mapId: "m", vectors: [good, { id: "b", name: "B", visible: true, lines: [[0.5]] }] });
  assert.deepEqual(vectors, [good]);
});

test("only the layers shown go to another app, in degrees", () => {
  const shown = read(geoPackage(["EPSG", 4326], [geometry(paris)]));
  const hidden = { ...shown, id: "other", visible: false };
  const { features } = shownLinesGeoJson([shown, hidden]);
  assert.equal(features.length, 1);
  assert.deepEqual(features[0]!.geometry.coordinates, paris);
});
