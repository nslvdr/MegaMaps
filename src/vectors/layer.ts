import { t } from "../i18n";
import { toLonLat, toMercator } from "../viewer/geo";
import { readGeoPackage } from "./gpkg";
import { isSqlite } from "./sqlite";

/** Lines drawn over a calibrated map, such as galleries traced in QGIS. Their
 * points are in Web Mercator, so they follow the map when it is calibrated again. */
export interface VectorLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Each line as x, y, x, y… where the whole world is the unit square. */
  lines: number[][];
}
const MAX_POINTS = 500_000;
const MERCATOR_LIMIT = 20_037_508.35;
/** Coordinates as read from a file, each line x, y, x, y… */
export type RawLines = number[][];
export type Crs = "lonlat" | "mercator";

/** Files sometimes declare degrees while holding Web Mercator metres: QGIS writes
 * that when a layer's CRS was overridden. Degrees can't exceed these bounds, so
 * coordinates that do are read as metres. */
export function linesToMercator(lines: RawLines, declared: Crs): number[][] {
  let points = 0, beyondDegrees = false;
  for (const line of lines) {
    points += line.length / 2;
    for (let i = 0; i < line.length; i += 2) {
      const x = line[i]!, y = line[i + 1]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MERCATOR_LIMIT || Math.abs(y) > MERCATOR_LIMIT) throw new Error(t("This file’s coordinates aren’t on Earth."));
      if (Math.abs(x) > 180 || Math.abs(y) > 90) beyondDegrees = true;
    }
  }
  if (points > MAX_POINTS) throw new Error(t("This file has too many points: {points} at most.", { points: MAX_POINTS.toLocaleString() }));
  const metres = declared === "mercator" || beyondDegrees;
  return lines.map((line) => {
    const out = new Array<number>(line.length);
    for (let i = 0; i < line.length; i += 2) {
      const { x, y } = metres
        ? { x: line[i]! / (2 * MERCATOR_LIMIT) + 0.5, y: 0.5 - line[i + 1]! / (2 * MERCATOR_LIMIT) }
        : toMercator({ lon: line[i]!, lat: Math.max(-85.06, Math.min(85.06, line[i + 1]!)) });
      out[i] = x;
      out[i + 1] = y;
    }
    return out;
  });
}

type Json = Record<string, unknown>;
const geoJsonLines = (geometry: unknown, out: RawLines) => {
  if (typeof geometry !== "object" || geometry === null) return;
  const { type, coordinates, geometries } = geometry as Json;
  const line = (points: unknown) => {
    if (Array.isArray(points) && points.length > 1)
      out.push(points.flatMap((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN]));
  };
  const each = (items: unknown, use: (item: unknown) => void) => { if (Array.isArray(items)) items.forEach(use); };
  if (type === "LineString") line(coordinates);
  else if (type === "MultiLineString" || type === "Polygon") each(coordinates, line);
  else if (type === "MultiPolygon") each(coordinates, (polygon) => each(polygon, line));
  else if (type === "GeometryCollection") each(geometries, (item) => geoJsonLines(item, out));
};
function readGeoJson(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(t("Choose a GeoPackage (.gpkg) or GeoJSON file."));
  }
  const { type, features, geometry } = (value ?? {}) as Json;
  const lines: RawLines = [];
  if (type === "FeatureCollection" && Array.isArray(features))
    for (const feature of features) geoJsonLines((feature as Json | null)?.geometry, lines);
  else geoJsonLines(type === "Feature" ? geometry : value, lines);
  return linesToMercator(lines, "lonlat");
}

/** The lines of a GeoPackage or GeoJSON file, recognised by their content. Points are left out. */
export function readVectorFile(bytes: Uint8Array, filename: string, id: string): VectorLayer {
  const lines = isSqlite(bytes) ? readGeoPackage(bytes) : readGeoJson(new TextDecoder().decode(bytes));
  if (!lines.length) throw new Error(t("This file has no lines to draw."));
  return { id, name: filename.replace(/\.[^.]+$/, "").slice(0, 100) || filename, visible: true, lines };
}
/** The shown layers as GeoJSON, for another app. Seven decimals of a degree is about a centimetre. */
export function shownLinesGeoJson(layers: VectorLayer[]) {
  const round = (degrees: number) => Math.round(degrees * 1e7) / 1e7;
  const lines = layers.filter((layer) => layer.visible).flatMap((layer) => layer.lines).map((line) => {
    const out: [number, number][] = [];
    for (let i = 0; i < line.length; i += 2) {
      const { lon, lat } = toLonLat({ x: line[i]!, y: line[i + 1]! });
      out.push([round(lon), round(lat)]);
    }
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: out } };
  });
  return { type: "FeatureCollection", features: lines };
}
/** Saved layers come from this app's storage or a backup file; drop anything malformed. */
export const isVectorLayer = (value: unknown): value is VectorLayer => {
  if (typeof value !== "object" || value === null) return false;
  const { id, name, visible, lines } = value as Json;
  return typeof id === "string" && typeof name === "string" && typeof visible === "boolean" && Array.isArray(lines) &&
    lines.every((line) => Array.isArray(line) && line.length >= 4 && line.length % 2 === 0 && line.every(Number.isFinite));
};
