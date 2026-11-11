import test from "node:test";
import assert from "node:assert/strict";
import { screenToWorld, worldToScreen, type Point } from "../src/viewer/camera";
import { compose, geoMetresPerPixel, geoNorth, invert, placeGeo, spotsGeo, spotsTooClose, streetTiles, toLonLat, toMercator } from "../src/viewer/geo";

const close = (actual: number, expected: number, within = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not ${expected}`);
const samePoint = (a: Point, b: Point, within = 1e-9) => {
  close(a.x, b.x, within);
  close(a.y, b.y, within);
};

test("composed and inverted similarities act like applying them in turn", () => {
  const a = { x: 40, y: -12, scale: 3, rotation: 0.7 },
    b = { x: -5, y: 9, scale: 0.25, rotation: -2.1 },
    p = { x: 123, y: 45 };
  samePoint(worldToScreen(compose(a, b), p), worldToScreen(a, worldToScreen(b, p)));
  samePoint(worldToScreen(invert(a), p), screenToWorld(a, p));
});

test("Web Mercator puts the world in a unit square and comes back", () => {
  samePoint(toMercator({ lon: 0, lat: 0 }), { x: 0.5, y: 0.5 });
  assert.ok(toMercator({ lon: 2.35, lat: 48.85 }).y < 0.5, "north is up");
  const paris = toLonLat(toMercator({ lon: 2.3488, lat: 48.8534 }));
  close(paris.lon, 2.3488);
  close(paris.lat, 48.8534);
});

test("two matched spots say where the whole map lies", () => {
  const map = { width: 4000, height: 3000 };
  // Where the map really lies: a quarter metre a pixel, its north 30° right of its top.
  const paris = toMercator({ lon: 2.3488, lat: 48.8534 }),
    metre = 1 / (40_075_016.686 * Math.cos((48.8534 * Math.PI) / 180)),
    truth = { ...paris, scale: 0.25 * metre, rotation: (-30 * Math.PI) / 180 };
  const spot = (p: Point) => ({ map: p, place: worldToScreen(truth, p) });
  const geo = spotsGeo(spot({ x: 500, y: 2600 }), spot({ x: 3500, y: 400 }));
  // Any other point of the map lands where it should.
  samePoint(worldToScreen(geo, { x: 2000, y: 100 }), worldToScreen(truth, { x: 2000, y: 100 }), 1e-12);
  close(geoNorth(geo), 30);
  close(geoMetresPerPixel(geo, map), 0.25, 1e-3);
});

test("with the scale and north known, one spot places the map", () => {
  const map = { width: 4000, height: 3000 }, place = toMercator({ lon: 2.3488, lat: 48.8534 }), point = { x: 500, y: 2600 };
  const geo = placeGeo({ map: point, place }, 0.25, 30);
  samePoint(worldToScreen(geo, point), place);
  // Measured at the map's center, a few hundred metres away.
  close(geoMetresPerPixel(geo, map), 0.25, 1e-4);
  close(geoNorth(geo), 30);
});

test("spots too close together on the map or the streets are refused", () => {
  const map = { width: 1000, height: 2000 },
    place = toMercator({ lon: 2.3488, lat: 48.8534 }),
    metre = 1 / (40_075_016.686 * Math.cos((48.8534 * Math.PI) / 180)),
    first = { map: { x: 0, y: 0 }, place },
    away = { x: place.x + 200 * metre, y: place.y };
  assert.equal(spotsTooClose(first, { map: { x: 300, y: 0 }, place: away }, map), false);
  assert.equal(spotsTooClose(first, { map: { x: 50, y: 0 }, place: away }, map), true, "on the map");
  assert.equal(spotsTooClose(first, { map: { x: 300, y: 0 }, place: { x: place.x + 3 * metre, y: place.y } }, map), true, "on the streets");
});

test("street tiles show near their own size and cover the screen", () => {
  const center = toMercator({ lon: 2.3488, lat: 48.8534 }),
    viewport = { width: 400, height: 800 };
  // About 300 screen pixels per zoom 17 tile.
  const scale = 300 * 2 ** 17;
  const view = { x: viewport.width / 2 - center.x * scale, y: viewport.height / 2 - center.y * scale, scale };
  const { z, tiles } = streetTiles(view, viewport);
  assert.equal(z, 17);
  const n = 2 ** z;
  for (const corner of [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 800 }, { x: 400, y: 800 }]) {
    const at = screenToWorld(view, corner);
    assert.ok(tiles.some(({ x, y }) => x === Math.floor(at.x * n) && y === Math.floor(at.y * n)), "every corner has its tile");
  }
  assert.ok(tiles.length <= 4 * 5, "no more tiles than the screen spans");
});
