import test from "node:test";
import assert from "node:assert/strict";
import { trailAge, trailAgeChange } from "../src/viewer/trail";
import { wheelChoice } from "../src/ui/hold-wheel";
import { arrows } from "../src/viewer/overlays";
import { normalizeNavigation } from "../src/viewer/navigation";

const minutes = (count: number) => count * 60_000;

test("the last point pulses, then slows, then rests as it ages", () => {
  assert.equal(trailAge(0, minutes(5)), "fresh");
  assert.equal(trailAgeChange(0, minutes(5)), minutes(10));
  assert.equal(trailAge(0, minutes(15)), "aging");
  assert.equal(trailAgeChange(0, minutes(15)), minutes(45));
  assert.equal(trailAge(0, minutes(60)), "old");
  assert.equal(trailAgeChange(0, minutes(60)), undefined, "an old point never changes again");
});

test("saves without a trail start empty and malformed points are dropped", () => {
  assert.deepEqual(normalizeNavigation({ mapId: "m" }).trail, []);
  const good = { x: 1, y: 2, time: 3 };
  assert.deepEqual(normalizeNavigation({ mapId: "m", trail: [good, { x: 1, y: 2 }, null, { x: "1", y: 2, time: 3 }] }).trail, [good]);
  assert.deepEqual(normalizeNavigation({ mapId: "m", trail: "nope" }).trail, []);
  const viewed = { ...good, view: { center: { x: 4, y: 5 }, scale: 0.5 } };
  assert.deepEqual(normalizeNavigation({ mapId: "m", trail: [viewed, { ...good, view: { scale: 1 } }] }).trail, [viewed],
    "a point keeps the view it was marked in, and one with a broken view is dropped");
});

test("the long-press wheel is three thirds: up-left a place, up-right back, down the trail", () => {
  const start = { x: 100, y: 100 };
  const at = (degrees: number) => wheelChoice(start, {
    x: start.x + 60 * Math.cos(degrees * Math.PI / 180), y: start.y - 60 * Math.sin(degrees * Math.PI / 180),
  });
  assert.deepEqual([150, 95, 205].map(at), ["place", "place", "place"]);
  assert.deepEqual([30, 85, 0, 335].map(at), ["back", "back", "back", "back"]);
  assert.deepEqual([270, 215, 325].map(at), ["trail", "trail", "trail"]);
  assert.equal(wheelChoice(start, { x: 110, y: 80 }), undefined, "near the middle, nothing");
});

test("a trail shows which way it went with a chevron on each long enough segment", () => {
  const d = arrows([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 110, y: 0 }]);
  assert.equal(d.match(/M/g)?.length, 1, "a short segment gets none");
  const [, tip] = d.match(/L([\d.-]+),/)!;
  assert.ok(Number(tip) > 50, "it points from the first point toward the next");
});

test("past trips load only whole: an id, an end, and at least two good points", () => {
  assert.deepEqual(normalizeNavigation({ mapId: "m" }).trips, []);
  const points = [{ x: 1, y: 2, time: 3 }, { x: 4, y: 5, time: 6 }];
  const trip = { id: "a", points, ended: 7 };
  assert.deepEqual(normalizeNavigation({ mapId: "m", trips: [
    trip, { id: "b", points: points.slice(0, 1), ended: 7 }, { id: "c", points: [points[0], { x: 1 }], ended: 7 },
    { points, ended: 7 }, { id: "d", points }, null,
  ] }).trips, [trip]);
});
