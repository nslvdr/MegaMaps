import test from "node:test";
import assert from "node:assert/strict";
import { CalloutLayout, boundsOverlap, segmentCrossesBounds, type CalloutBounds } from "../src/viewer/callout-layout";
import type { Point } from "../src/viewer/camera";

const viewport = { width: 600, height: 600 };
const target = { left: 288, right: 312, top: 288, bottom: 312 };
const size = { width: 100, height: 36 };

test("callouts use all eight directions when the other spaces are occupied", () => {
  for (const [name, dx, dy] of [
    ["above", 0, -1], ["below", 0, 1], ["right", 1, 0], ["left", -1, 0],
    ["upper-right", 1, -1], ["upper-left", -1, -1],
    ["lower-right", 1, 1], ["lower-left", -1, 1],
  ] as const) {
    const layout = new CalloutLayout(viewport);
    if (dx !== 1) layout.addObstacle({ left: 322, right: 600, top: 294, bottom: 306 });
    if (dx !== -1) layout.addObstacle({ left: 0, right: 278, top: 294, bottom: 306 });
    if (dy !== -1) layout.addObstacle({ left: 294, right: 306, top: 0, bottom: 278 });
    if (dy !== 1) layout.addObstacle({ left: 294, right: 306, top: 322, bottom: 600 });
    if (dx === 1) layout.addObstacle({ left: 0, right: 278, top: 0, bottom: 600 });
    if (dx === -1) layout.addObstacle({ left: 322, right: 600, top: 0, bottom: 600 });
    if (dy === -1) layout.addObstacle({ left: 0, right: 600, top: 322, bottom: 600 });
    if (dy === 1) layout.addObstacle({ left: 0, right: 600, top: 0, bottom: 278 });
    if (dx && dy) {
      // Leave the requested quadrant clear, with a corridor to the target.
      layout.addObstacle({ left: dx > 0 ? 0 : 288, right: dx > 0 ? 312 : 600,
        top: dy < 0 ? 0 : 322, bottom: dy < 0 ? 278 : 600 });
      layout.addObstacle({ left: dx > 0 ? 322 : 0, right: dx > 0 ? 600 : 278,
        top: dy < 0 ? 288 : 0, bottom: dy < 0 ? 600 : 312 });
    }
    const placement = layout.place(size, target);
    assert.ok(placement, `available space ${name} must be used`);
    assert.equal(placement.direction, name);
  }
});

test("crowded callouts share free space without covering labels, anchors, or panels", () => {
  const panel = { left: 120, right: 480, top: 470, bottom: 600 };
  const targets = Array.from({ length: 8 }, (_, index) => ({
    left: 265 + (index % 4) * 25, right: 285 + (index % 4) * 25,
    top: 270 + Math.floor(index / 4) * 35, bottom: 290 + Math.floor(index / 4) * 35,
  }));
  const layout = new CalloutLayout(viewport, [panel, ...targets]);
  const placed = targets.map(bounds => layout.place(size, bounds));
  assert.ok(placed.every(Boolean), "a crowded cluster with free surrounding space keeps all labels");
  for (const [index, placement] of placed.entries()) {
    assert.ok(placement);
    assert.equal(boundsOverlap(placement.bounds, panel), false);
    for (const bounds of targets) {
      assert.equal(boundsOverlap(placement.bounds, bounds), false);
      assert.equal(segmentCrossesBounds(placement.from, placement.to, bounds), false);
    }
    for (const other of placed.slice(index + 1)) {
      assert.ok(other);
      assert.equal(boundsOverlap(placement.bounds, other.bounds), false);
      assert.equal(segmentCrossesBounds(placement.from, placement.to, other.bounds), false);
    }
  }
});

test("placement stays inside the viewport and keeps its direction during small pans", () => {
  for (const [x, y] of [[8, 8], [590, 8], [8, 590], [590, 590]] as const) {
    const bounds = { left: x - 6, right: x + 6, top: y - 6, bottom: y + 6 };
    const placement = new CalloutLayout(viewport).place(size, bounds);
    assert.ok(placement);
    assert.ok(placement.bounds.left >= 8 && placement.bounds.top >= 8);
    assert.ok(placement.bounds.right <= 592 && placement.bounds.bottom <= 592);
    assert.equal(boundsOverlap(placement.bounds, bounds), false);
  }
  const previous = new CalloutLayout(viewport).place(size, target);
  assert.ok(previous);
  const moved = { left: target.left + 1, right: target.right + 1,
    top: target.top + 1, bottom: target.bottom + 1 };
  const next = new CalloutLayout(viewport).place(size, moved, undefined, previous);
  assert.ok(next);
  assert.equal(next.direction, previous.direction);
  assert.equal(next.gap, previous.gap);
  assert.equal(next.bounds.left - previous.bounds.left, 1);
  assert.equal(next.bounds.top - previous.bounds.top, 1);
});

test("when no free space exists, the layout leaves anchors unobscured", () => {
  const layout = new CalloutLayout(viewport, [{ left: 0, right: 600, top: 0, bottom: 600 }]);
  assert.equal(layout.place(size, target), undefined);
});
test("crowded labels never land on or draw across anything already placed", () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const box = (x: number, y: number, pad: number) => ({ left: x - pad, right: x + pad, top: y - pad, bottom: y + pad });
  let placed = 0;
  for (let scene = 0; scene < 25; scene++) {
    const view = { width: 300 + random() * 1000, height: 300 + random() * 600 };
    const spread = () => [random() * view.width * 1.4 - view.width * 0.2, random() * view.height * 1.4 - view.height * 0.2] as const;
    // A few large ones span many grid cells and the screen's edges.
    const obstacles = Array.from({ length: Math.floor(random() * 400) }, () =>
      box(...spread(), random() < 0.02 ? 60 + random() * 200 : 6 + random() * 12));
    const layout = new CalloutLayout(view, obstacles);
    // Pins wholly off screen are dropped; a leader may pass them on its way out.
    const kept = obstacles.filter(rect => rect.right >= 0 && rect.bottom >= 0 && rect.left <= view.width && rect.top <= view.height);
    const taken: CalloutBounds[] = [], leaders: { from: Point; to: Point }[] = [];
    for (let label = 0; label < 60; label++) {
      const [x, y] = spread();
      const placement = layout.place({ width: 60 + random() * 200, height: 36 }, box(x, y, 8 + random() * 10), { x, y });
      if (!placement) continue;
      placed++;
      const padded = { left: placement.bounds.left - 5, right: placement.bounds.right + 5,
        top: placement.bounds.top - 5, bottom: placement.bounds.bottom + 5 };
      for (const rect of [...obstacles, ...taken])
        assert.equal(boundsOverlap(padded, rect), false, "a label stays clear of pins and labels");
      for (const rect of [...kept, ...taken])
        assert.equal(segmentCrossesBounds(placement.from, placement.to, rect), false, "its leader crosses nothing on screen");
      for (const line of leaders)
        assert.equal(segmentCrossesBounds(line.from, line.to, padded), false, "no earlier leader runs under it");
      taken.push(placement.bounds);
      leaders.push(placement);
    }
  }
  assert.ok(placed > 200, `${placed} labels placed`);
});
