import test from "node:test";
import assert from "node:assert/strict";
import { clampScale, clampView, zoomAt } from "../src/ui/photo-viewer";

// A 400×800 phone screen showing a 2000×1000 landscape photo: 400×200, 300px from the top.
const screen = { width: 400, height: 800 };
const photo = { width: 2000, height: 1000 };

test("zooming keeps the photo point under the fingers", () => {
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 3, { x: 100, y: 400 });
  assert.deepEqual(zoomed, { scale: 3, x: -200, y: -800 });
  // The photo point that was under (100, 400) is still drawn there.
  assert.equal(zoomed.x + 100 * zoomed.scale, 100);
  assert.equal(zoomed.y + 400 * zoomed.scale, 400);
  const moved = zoomAt(zoomed, 3, { x: 100, y: 400 }, { x: 150, y: 420 });
  assert.deepEqual(moved, { scale: 3, x: -150, y: -780 }, "pinching while moving pans with the fingers");
});

test("the whole photo stays reachable and never drifts off screen", () => {
  assert.deepEqual(clampView({ scale: 1, x: 90, y: -50 }, screen, photo), { scale: 1, x: 0, y: 0 }, "unzoomed, it sits centered");
  // At 3×, the photo is 1200×600: wider than the screen, still shorter.
  const left = clampView({ scale: 3, x: 500, y: 0 }, screen, photo);
  assert.equal(left.x, 0, "its left edge stops at the screen's");
  const right = clampView({ scale: 3, x: -5000, y: 0 }, screen, photo);
  assert.equal(right.x, 400 - 1200, "its right edge stops at the screen's");
  assert.equal(left.y + 300 * 3, (800 - 600) / 2, "the short side stays centered");
  // At 5×, 1000px tall: the letterbox above it can't be panned into view.
  const top = clampView({ scale: 5, x: 0, y: 0 }, screen, photo);
  assert.equal(top.y + 300 * 5, 0);
});

test("zoom stays between the fitted photo and five times it", () => {
  assert.equal(clampScale(0.4), 1);
  assert.equal(clampScale(9), 5);
  assert.equal(clampView({ scale: 9, x: 0, y: 0 }, screen, photo).scale, 5);
});
