import test from "node:test";
import assert from "node:assert/strict";
import { mapSize } from "../src/processing/headers";
import { shrinkRows } from "../src/processing/shrink";
import { MAX_PIXELS } from "../src/types";

test("images over the map limits shrink to fit, keeping their shape", () => {
  assert.deepEqual(mapSize(20000, 15000), { width: 20000, height: 15000 }, "maps within the limits keep their size");
  const big = mapSize(40000, 25000);
  assert.ok(big.width * big.height <= MAX_PIXELS && big.width * big.height > MAX_PIXELS * 0.999);
  assert.ok(Math.abs(big.width / big.height - 1.6) < 0.001);
  assert.deepEqual(mapSize(50000, 1000), { width: 32768, height: 655 }, "a long strip fits the widest side");
  assert.equal(mapSize(65500, 100).width, 32768);
});

test("shrunk rows average the source area each map pixel covers, row by row", async () => {
  // A 5×3 ramp onto 2×2: each map pixel covers 2.5 × 1.5 source pixels.
  const rows: [number, number[]][] = [];
  const consume = shrinkRows({ width: 5, height: 3 }, { width: 2, height: 2 }, async (row, y) => {
    rows.push([y, [...row]]);
  });
  for (let y = 0; y < 3; y++) {
    const row = new Uint8ClampedArray(5 * 4);
    for (let x = 0; x < 5; x++) row.set([10 * x + 100 * y, 10 * x + 100 * y, 0, 255], x * 4);
    await consume(row, y);
  }
  assert.deepEqual(rows, [
    [0, [41, 41, 0, 255, 65, 65, 0, 255]],
    [1, [175, 175, 0, 255, 199, 199, 0, 255]],
  ]);
  const same = async () => {};
  assert.equal(shrinkRows({ width: 5, height: 3 }, { width: 5, height: 3 }, same), same, "a map that fits is not resampled");
});
