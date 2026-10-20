import test from "node:test";
import assert from "node:assert/strict";
import { trailAge, trailAgeChange } from "../src/viewer/trail";
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
