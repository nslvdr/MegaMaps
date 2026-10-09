import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { pyramid, tileCount } from "../src/processing/pyramid";
import {
  cameraAt,
  fitCamera,
  worldToScreen,
  zoomAt,
  constrain,
  chooseLevel,
  visibleTiles,
} from "../src/viewer/camera";
import { readHeader } from "../src/processing/headers";
import { decodePNG, unfilter } from "../src/processing/png";
import { TILE_SIZE } from "../src/types";

function png(
  width: number,
  height: number,
  depth: number,
  color: number,
  data: Uint8Array,
  palette?: Uint8Array,
  transparency?: Uint8Array,
) {
  const chunk = (kind: string, body: Uint8Array) => {
    const bytes = Buffer.alloc(12 + body.length);
    bytes.writeUInt32BE(body.length);
    bytes.write(kind, 4);
    bytes.set(body, 8);
    return bytes;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = color;
  return new Blob([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...(palette ? [chunk("PLTE", palette)] : []),
    ...(transparency ? [chunk("tRNS", transparency)] : []),
    chunk("IDAT", deflateSync(data)),
    chunk("IEND", new Uint8Array()),
  ]);
}
test("9k and 15k pyramid cover odd dimensions with an exact native level", () => {
  for (const side of [1000, 4000, 9000, 15001]) {
    const levels = pyramid(side, side - 3);
    assert.equal(levels[0]!.width, side);
    assert.equal(levels[0]!.scale, 1);
    assert.ok(levels.at(-1)!.width <= TILE_SIZE);
    assert.ok(levels.at(-1)!.height <= TILE_SIZE);
    assert.ok(tileCount(levels) > 0);
    for (const level of levels)
      assert.ok(level.cols * TILE_SIZE >= level.width);
  }
  assert.equal(tileCount(pyramid(9000, 9000)), 444);
});
test("zoom preserves the image coordinate under the cursor", () => {
  const camera = { x: -241, y: -85, scale: 0.4 },
    x = 132,
    y = 317;
  const zoomed = zoomAt(camera, 2, x, y);
  assert.equal((x - camera.x) / camera.scale, (x - zoomed.x) / zoomed.scale);
  assert.equal((y - camera.y) / camera.scale, (y - zoomed.y) / zoomed.scale);
});
test("fit, bounds, and DPR-aware tile selection", () => {
  const image = { width: 9000, height: 9000 },
    viewport = { width: 390, height: 844 };
  const fit = fitCamera(image, viewport);
  assert.equal(fit.x, 0);
  assert.equal(fit.y, 227);
  assert.deepEqual(
    constrain({ x: 100, y: -50000, scale: 1 }, image, viewport),
    { x: 100, y: -8578, scale: 1 },
  );
  const levels = pyramid(9000, 9000);
  assert.equal(chooseLevel(levels, 1, 2), 0);
  assert.equal(chooseLevel(levels, 0.05, 2), 3);
  const visible = visibleTiles(
    levels[0]!,
    { x: -8700, y: -8700, scale: 1 },
    viewport,
  );
  assert.ok(visible.every((t) => t.x >= 0 && t.y >= 0 && t.x < 18 && t.y < 18));
  assert.ok(visible.some((t) => t.x === 17 && t.y === 17));
});
test("map edges and corners can be centered at fit and native zoom, including rotation", () => {
  const image = { width: 9000, height: 4000 };
  const points = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: 0, y: image.height },
    { x: image.width, y: image.height },
    { x: image.width / 2, y: 0 },
    { x: image.width / 2, y: image.height },
    { x: 0, y: image.height / 2 },
    { x: image.width, y: image.height / 2 },
  ];
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }])
    for (const rotation of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 3])
      for (const scale of [fitCamera(image, viewport, rotation).scale, 1]) {
        const fit = fitCamera(image, viewport, rotation);
        assert.deepEqual(constrain(fit, image, viewport), fit);
        for (const point of points) {
          const camera = constrain(cameraAt(point, viewport, scale, rotation), image, viewport);
          const screen = worldToScreen(camera, point);
          assert.ok(Math.abs(screen.x - viewport.width / 2) < 1e-7);
          assert.ok(Math.abs(screen.y - viewport.height / 2) < 1e-7);
        }
      }
});
test("panning stops when a map edge reaches the center instead of losing the map", () => {
  const image = { width: 512, height: 512 },
    viewport = { width: 390, height: 844 };
  for (const scale of [fitCamera(image, viewport).scale, 2]) {
    const topLeft = constrain({ x: 10000, y: 10000, scale }, image, viewport);
    assert.deepEqual(worldToScreen(topLeft, { x: 0, y: 0 }), { x: 195, y: 422 });
    const bottomRight = constrain({ x: -10000, y: -10000, scale }, image, viewport);
    assert.deepEqual(worldToScreen(bottomRight, { x: 512, y: 512 }), { x: 195, y: 422 });
  }
});
test("PNG row filters reconstruct previous-row and left-pixel predictors", () => {
  const previous = Uint8Array.from([10, 20, 30, 40]);
  const expectations = [
    [1, 2, 3, 4],
    [1, 3, 6, 10],
    [11, 22, 33, 44],
    [6, 15, 25, 36],
    [11, 22, 33, 44],
  ];
  for (let f = 0; f < 5; f++) {
    const row = Uint8Array.from([1, 2, 3, 4]);
    unfilter(row, previous, 1, f);
    assert.deepEqual([...row], expectations[f]);
  }
  assert.throws(() => unfilter(new Uint8Array(1), new Uint8Array(1), 1, 5));
});
test("streaming PNG supports RGBA, packed palette, transparency and 16-bit grayscale", async () => {
  const cases = [
    {
      file: png(
        2,
        1,
        8,
        6,
        Uint8Array.from([0, 10, 20, 30, 255, 40, 50, 60, 128]),
      ),
      expected: [10, 20, 30, 255, 40, 50, 60, 128],
    },
    {
      file: png(
        2,
        1,
        1,
        3,
        Uint8Array.from([0, 0x40]),
        Uint8Array.from([255, 0, 0, 0, 255, 0]),
        Uint8Array.from([255, 0]),
      ),
      expected: [255, 0, 0, 255, 0, 255, 0, 0],
    },
    {
      file: png(2, 1, 16, 0, Uint8Array.from([0, 0x12, 0x34, 0xff, 0xff])),
      expected: [18, 18, 18, 255, 255, 255, 255, 255],
    },
  ];
  for (const item of cases) {
    let pixels: number[] = [];
    await decodePNG(item.file, await readHeader(item.file), async (row) => {
      pixels = [...row];
    });
    assert.deepEqual(pixels, item.expected);
  }
});
test("malformed, oversized, and truncated pixel data fail explicitly", async () => {
  await assert.rejects(readHeader(new Blob(["not an image"])));
  await assert.rejects(readHeader(png(65535, 65535, 8, 2, new Uint8Array())));
  const truncated = png(2, 2, 8, 6, Uint8Array.from([0, 1, 2, 3, 4]));
  await assert.rejects(
    decodePNG(truncated, await readHeader(truncated), async () => {}),
    /Truncated/,
  );
});
