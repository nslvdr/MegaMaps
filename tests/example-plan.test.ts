import test from "node:test";
import assert from "node:assert/strict";
import { crossing, HAGUE_WIDTH, hagues, layout, onWay, PLAN_HEIGHT, PLAN_WIDTH, ways } from "../src/example/plan";
import type { Point } from "../src/viewer/camera";

// The plan's floor in one-unit cells: what isn't pillar, rock or wall.
function floorPlan() {
  const cells = (polygon: Point[], mark: (x: number, y: number) => void) => {
    const ys = polygon.map((p) => p.y);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(PLAN_HEIGHT - 1, Math.ceil(Math.max(...ys))); y++) {
      const row = y + 0.5, xs: number[] = [];
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length]!;
        if ((a.y > row) !== (b.y > row)) xs.push(a.x + ((row - a.y) * (b.x - a.x)) / (b.y - a.y));
      });
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xs[k]! - 0.5)); x <= Math.min(PLAN_WIDTH - 1, Math.floor(xs[k + 1]! - 0.5)); x++) mark(x, y);
    }
  };
  const near = (points: Point[], reach: number, test: (p: Point) => boolean, mark: (x: number, y: number) => void) => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    for (let y = Math.floor(Math.min(...ys) - reach); y <= Math.max(...ys) + reach; y++)
      for (let x = Math.floor(Math.min(...xs) - reach); x <= Math.max(...xs) + reach; x++)
        if (test({ x: x + 0.5, y: y + 0.5 })) mark(x, y);
  };
  const floor = new Uint8Array(PLAN_WIDTH * PLAN_HEIGHT);
  const { outlines, pillars, masses } = layout();
  outlines.forEach((outline, k) => {
    const sector = new Uint8Array(floor.length);
    cells(outline, (x, y) => (sector[y * PLAN_WIDTH + x] = floor[y * PLAN_WIDTH + x] = 1));
    // Pillars and rock are clipped to their own working.
    for (const shape of [...pillars[k]!.map((pillar) => pillar.points), ...masses[k]!])
      cells(shape, (x, y) => sector[y * PLAN_WIDTH + x] && (floor[y * PLAN_WIDTH + x] = 0));
  });
  for (const way of ways) near(way.points, way.width, (p) => onWay(p, way), (x, y) => (floor[y * PLAN_WIDTH + x] = 1));
  for (const [a, b] of hagues) near([a, b], HAGUE_WIDTH, (p) => {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
    return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y)) <= HAGUE_WIDTH / 2;
  }, (x, y) => (floor[y * PLAN_WIDTH + x] = 0));
  return floor;
}

/** The floor's separate pieces, biggest first, in cells. */
function pieces(floor: Uint8Array, from: Point) {
  const seen = new Uint8Array(floor.length), sizes: number[] = [];
  const flood = (start: number) => {
    let size = 0;
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const cell = queue.pop()!;
      size++;
      const x = cell % PLAN_WIDTH;
      for (const next of [x > 0 ? cell - 1 : -1, x < PLAN_WIDTH - 1 ? cell + 1 : -1, cell - PLAN_WIDTH, cell + PLAN_WIDTH])
        if (next >= 0 && next < floor.length && floor[next] && !seen[next]) (seen[next] = 1), queue.push(next);
    }
    return size;
  };
  const main = flood(Math.floor(from.y) * PLAN_WIDTH + Math.floor(from.x));
  for (let cell = 0; cell < floor.length; cell++) if (floor[cell] && !seen[cell]) sizes.push(flood(cell));
  return { main, others: sizes.sort((a, b) => b - a) };
}

test("every gallery of the example plan connects, across all its workings", () => {
  const { others } = pieces(floorPlan(), crossing(0, 0));
  // Only specks where a pillar's corner meets a wall stay apart; a sealed
  // gallery is hundreds of cells.
  assert.ok((others[0] ?? 0) < 20, `a part of the plan of ${others[0]} cells can't be reached`);
});
