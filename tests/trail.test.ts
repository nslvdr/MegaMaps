import test from "node:test";
import assert from "node:assert/strict";
import { TRAIL_GAP_MS, trailAge, trailAgeChange, trailSegments } from "../src/viewer/trail";
import { normalizeNavigation } from "../src/viewer/navigation";

const minutes = (count: number) => count * 60_000;

test("a long gap between points starts another trip", () => {
  const point = (time: number) => ({ x: time, y: 0, time });
  const trail = [point(0), point(minutes(20)), point(minutes(20) + TRAIL_GAP_MS), point(minutes(30) + TRAIL_GAP_MS)];
  assert.deepEqual(trailSegments(trail), [trail.slice(0, 2), trail.slice(2)]);
  assert.deepEqual(trailSegments([]), []);
});

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
