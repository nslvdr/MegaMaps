import test from "node:test";
import assert from "node:assert/strict";
import { setPreference } from "../src/preferences";
import { formatDistance, formatWalk, pathLength, travelSummary } from "../src/viewer/measure";

test("a line's length adds up its segments", () => {
  assert.equal(pathLength([]), 0);
  assert.equal(pathLength([{ x: 5, y: 5 }]), 0);
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 90 }]), 100);
});

test("distances round to what a hand-set scale can tell", () => {
  assert.equal(formatDistance(4.46), "4.5 m");
  assert.equal(formatDistance(420.4), "420 m");
  assert.equal(formatDistance(1237), "1.24 km");
  assert.equal(formatDistance(12_340), "12.3 km");
});

test("walking time follows the walking speed setting, 4 km/h by default", () => {
  assert.equal(formatWalk(10), "< 1 min");
  assert.equal(formatWalk(420), "6 min");
  assert.equal(formatWalk(4200), "1 h 03");
  setPreference("walking-speed", "2");
  try {
    assert.equal(formatWalk(420), "13 min");
  } finally {
    localStorage.removeItem("megamaps:walking-speed");
  }
});

test("a route only has a length once the map has a scale and the route two points", () => {
  const points = [{ x: 0, y: 0 }, { x: 600, y: 800 }];
  assert.equal(travelSummary(points), undefined);
  assert.equal(travelSummary(points.slice(0, 1), 0.5), undefined);
  assert.equal(travelSummary(points, 0.5), "500 m · ~8 min on foot");
});
