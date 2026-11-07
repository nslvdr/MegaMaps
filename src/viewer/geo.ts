import { onScreen, screenToWorld, viewBounds, worldToScreen, type Camera, type Point, type Size } from "./camera";

/** Where a map lies on Earth: a similarity, shaped like a camera, from image
 * pixels to Web Mercator, where the whole world is the unit square, north up. */
export type Geo = Camera;
export interface LonLat {
  lon: number;
  lat: number;
}
const EARTH_CIRCUMFERENCE = 40_075_016.686;
/** The deepest zoom OpenStreetMap's tiles go to. */
export const MAX_STREET_ZOOM = 19;
export const STREET_TILE_SIZE = 256;

/** `a` after `b`, as one similarity. */
export function compose(a: Camera, b: Camera): Camera {
  const origin = worldToScreen(a, { x: b.x, y: b.y }),
    rotation = (a.rotation ?? 0) + (b.rotation ?? 0);
  return { ...origin, scale: a.scale * b.scale, rotation: Math.atan2(Math.sin(rotation), Math.cos(rotation)) };
}
export function invert(a: Camera): Camera {
  return { ...screenToWorld(a, { x: 0, y: 0 }), scale: 1 / a.scale, rotation: -(a.rotation ?? 0) };
}
export function toMercator({ lon, lat }: LonLat): Point {
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}
export function toLonLat({ x, y }: Point): LonLat {
  return { lon: x * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI };
}
/** A nearby point the way a bearing goes, in Mercator: enough to tell a direction on any map. */
export function aheadOf(place: LonLat, bearing: number): Point {
  const { x, y } = toMercator(place), radians = (bearing * Math.PI) / 180;
  return { x: x + Math.sin(radians) * 1e-6, y: y - Math.cos(radians) * 1e-6 };
}
/** Metres a Mercator unit covers where `point` is; it shrinks toward the poles. */
const metresPerUnit = (point: Point) => EARTH_CIRCUMFERENCE * Math.cos((toLonLat(point).lat * Math.PI) / 180);
/** Real metres one image pixel covers, at the map's center. */
export const geoMetresPerPixel = (geo: Geo, map: Size) =>
  geo.scale * metresPerUnit(worldToScreen(geo, { x: map.width / 2, y: map.height / 2 }));
/** Degrees clockwise from the map's top that north is, as the North offset counts them. */
export function geoNorth({ rotation = 0 }: Geo) {
  return (-Math.atan2(Math.sin(rotation), Math.cos(rotation)) * 180) / Math.PI;
}
/** One spot found on both: where it is on the map, in image pixels, and on the streets, in Mercator. */
export interface Spot {
  map: Point;
  place: Point;
}
/** Two spots say where the whole map lies: the line between them on the map,
 * moved, turned and resized onto the same line on the streets. */
export function spotsGeo(a: Spot, b: Spot): Geo {
  const from = { x: b.map.x - a.map.x, y: b.map.y - a.map.y },
    to = { x: b.place.x - a.place.x, y: b.place.y - a.place.y },
    scale = Math.hypot(to.x, to.y) / Math.hypot(from.x, from.y),
    rotation = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
  return pinGeo(a, scale, rotation);
}
/** With the scale and turn already known, one spot says where the map lies. */
export function pinGeo({ map, place }: Spot, scale: number, rotation: number): Geo {
  const p = worldToScreen({ x: 0, y: 0, scale, rotation }, map);
  return { x: place.x - p.x, y: place.y - p.y, scale, rotation };
}
/** The same from the map's own scale and North offset. */
export const placeGeo = (spot: Spot, metresPerPixel: number, northOffset: number) =>
  pinGeo(spot, metresPerPixel / metresPerUnit(spot.place), (-northOffset * Math.PI) / 180);
/** Close spots magnify any slip of the finger across the rest of the map. */
export const spotsTooClose = (a: Spot, b: Spot, map: Size) =>
  Math.hypot(b.map.x - a.map.x, b.map.y - a.map.y) < Math.min(map.width, map.height) / 10 ||
  Math.hypot(b.place.x - a.place.x, b.place.y - a.place.y) * metresPerUnit(a.place) < 10;
/** The street tiles covering the screen, at the zoom whose tiles show closest
 * to their own size. `view` takes Mercator to screen pixels. */
export function streetTiles(view: Camera, viewport: Size) {
  const z = Math.max(0, Math.min(MAX_STREET_ZOOM, Math.round(Math.log2(view.scale / STREET_TILE_SIZE)))),
    n = 2 ** z,
    bounds = viewBounds(view, viewport);
  const x0 = Math.max(0, Math.floor(bounds.left * n)), x1 = Math.min(n - 1, Math.floor(bounds.right * n)),
    y0 = Math.max(0, Math.floor(bounds.top * n)), y1 = Math.min(n - 1, Math.floor(bounds.bottom * n));
  const tiles: Point[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (onScreen(view, viewport, { x: x / n, y: y / n, width: 1 / n, height: 1 / n })) tiles.push({ x, y });
  return { z, tiles };
}
