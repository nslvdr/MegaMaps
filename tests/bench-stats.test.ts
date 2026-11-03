import test from "node:test";
import assert from "node:assert/strict";
import { adjustedChances, differenceChance, median, quantile, verdict } from "../bench/stats";

test("bench medians and quartiles interpolate between samples", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
});

test("bench difference chance matches the exact Mann–Whitney test", () => {
  // Fully separated samples of 5: 2 of the 252 orderings are this extreme.
  assert.equal(differenceChance([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]), 2 / 252);
  assert.equal(differenceChance([1, 2, 3], [4, 5, 6]), 0.1);
  // U = 6 of 16: 24 of the 70 orderings are at least this low.
  assert.equal(differenceChance([1, 3, 5, 7], [2, 4, 6, 8]), 48 / 70);
});

test("bench chances grow with the count of numbers compared, keeping their order", () => {
  const adjusted = adjustedChances([0.01, 0.04, 0.03, 0.5]);
  assert.deepEqual(adjusted.map((chance) => Number(chance.toFixed(4))), [0.04, 0.0533, 0.0533, 0.5]);
  assert.deepEqual(adjustedChances([0.02]), [0.02], "one number stays as it is");
});

test("bench calls a change only when runs separate and it is big enough", () => {
  const base = [100, 101, 102, 103, 104];
  const chance = (next: number[]) => differenceChance(base, next);
  assert.equal(verdict(base, [80, 81, 82, 83, 84], chance([80, 81, 82, 83, 84])), "faster");
  assert.equal(verdict(base, [120, 121, 122, 123, 124], chance([120, 121, 122, 123, 124])), "slower");
  assert.equal(verdict(base, [98, 125, 92, 118, 101], chance([98, 125, 92, 118, 101])), "same", "overlapping runs are noise");
  assert.equal(verdict(base, [102.5, 102.6, 102.7, 102.8, 102.9], 0.008), "same", "under 1% is too small to matter");
  assert.equal(verdict(base, [118, 119, 118, 119, 118], 0.008, 1000 / 60), "same", "one frame is the step a frame time moves in");
  assert.equal(verdict(base, [80, 81, 82, 83, 84], 0.06), "same", "a chance too high after adjusting is noise");
});
