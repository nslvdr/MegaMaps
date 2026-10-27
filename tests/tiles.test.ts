import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { installPlatform, jpegFactory, nativeStats } from "./node-platform";
import { readHeader } from "../src/processing/headers";
import { cropJPEG, decodeJPEG } from "../src/processing/jpeg";
import { tileBand, buildParents } from "../src/processing/tiles";
import { payloadStore } from "../src/storage/payloads";
import { pyramid, tileCount } from "../src/processing/pyramid";
import { TileCache, TILE_CACHE_BUDGET } from "../src/viewer/cache";
import { TILE_SIZE, tileKey } from "../src/types";

test("JPEG rows become lossless native tiles and correct odd-sized pyramid edges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-test-"));
  await installPlatform(root);
  try {
    const source = createCanvas(1025, 777),
      ctx = source.getContext("2d");
    ctx.fillStyle = "#dcd6ad";
    ctx.fillRect(0, 0, 1025, 777);
    ctx.fillStyle = "#004488";
    ctx.fillRect(512, 0, 513, 777);
    const file = new Blob([new Uint8Array(await source.encode("jpeg"))]);
    const header = await readHeader(file),
      levels = pyramid(header.width, header.height),
      store = payloadStore("opfs");
    await store.put("test", "original", file);
    let done = 0,
      expected: number[] = [];
    const canvas = new OffscreenCanvas(1, 1),
      consume = tileBand(header, canvas, store, "test", () => done++);
    await decodeJPEG(
      file,
      header,
      "test",
      "opfs",
      async (row, y) => {
        if (y === 776) expected = [...row.subarray(1024 * 4, 1025 * 4)];
        await consume(row, y);
      },
      jpegFactory,
    );
    await buildParents(levels, canvas, store, "test", () => done++);
    assert.equal(done, tileCount(levels));
    const edge = await loadImage(
      Buffer.from(
        await (await store.get("test", tileKey(0, 2, 1))).arrayBuffer(),
      ),
    );
    assert.equal(edge.width, 1);
    assert.equal(edge.height, 265);
    const pixel = createCanvas(1, 265),
      pctx = pixel.getContext("2d");
    pctx.drawImage(edge, 0, 0);
    assert.deepEqual([...pctx.getImageData(0, 264, 1, 1).data], expected);
    const last = levels.at(-1)!;
    const preview = await loadImage(
      Buffer.from(
        await (
          await store.get("test", tileKey(levels.length - 1, 0, 0))
        ).arrayBuffer(),
      ),
    );
    assert.equal(preview.width, last.width);
    assert.equal(preview.height, last.height);
    assert.equal(nativeStats.decodedBytes, 0);
    await store.deleteMap("test");
    assert.deepEqual(await readdir(path.join(root, "maps")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed JPEG errors release decoder handles and allow map cleanup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-bad-"));
  await installPlatform(root);
  try {
    const store = payloadStore("opfs");
    const file = new Blob([new Uint8Array([255, 216, 255, 217])]);
    await store.put("bad", "original", file);
    await assert.rejects(
      decodeJPEG(
        file,
        { width: 9000, height: 9000, format: "jpeg", orientation: 1 },
        "bad",
        "opfs",
        async () => {},
        jpegFactory,
      ),
    );
    await store.deleteMap("bad");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tile cache limits concurrency and bytes, drops obsolete requests, closes on disposal", async () => {
  const canvas = createCanvas(512, 512);
  const blob = new Blob([new Uint8Array(await canvas.encode("png"))]);
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-cache-"));
  await installPlatform(root);
  let active = 0,
    peak = 0,
    completed = 0;
  const store = {
    async put() {},
    async deleteMap() {},
    async get() {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      completed++;
      return blob;
    },
  };
  const cache = new TileCache(
    store,
    "test",
    () => {},
    (message) => assert.fail(message),
  );
  const settle = async (generation: number) => {
    for (
      let i = 0;
      i < 500 &&
      cache.tiles.filter((tile) => tile.y === generation).length < 22;
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(
      cache.tiles.filter((tile) => tile.y === generation).length,
      22,
    );
  };
  try {
    cache.plan(Array.from({ length: 22 }, (_, x) => ({ level: 0, x, y: 0 })));
    assert.equal(cache.complete, false, "coarser layers fill in while tiles load");
    await settle(0);
    assert.equal(cache.complete, true);
    assert.equal(completed, 22);
    assert.ok(peak <= 2);
    assert.equal(cache.decodedBytes, 22 * 1048576);
    completed = 0;
    cache.plan(Array.from({ length: 22 }, (_, x) => ({ level: 0, x, y: 1 })));
    await settle(1);
    assert.ok(cache.decodedBytes <= TILE_CACHE_BUDGET);
    cache.plan(Array.from({ length: 200 }, (_, x) => ({ level: 0, x, y: 2 })));
    cache.plan([{ level: 1, x: 0, y: 0 }]);
    assert.ok(cache.queued <= 1);
    cache.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(cache.decodedBytes, 0);
    assert.equal(nativeStats.decodedBytes, 0);
  } finally {
    cache.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("tiles just off screen load after the screen, one at a time, into room it leaves", async () => {
  const canvas = createCanvas(512, 512);
  const blob = new Blob([new Uint8Array(await canvas.encode("png"))]);
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-ahead-"));
  await installPlatform(root);
  const reads: string[] = [], broken = new Set([tileKey(0, 3, 1)]);
  let screenLoading = 0, aheadActive = 0, aheadPeak = 0, repaints = 0;
  const errors: string[] = [];
  const isAhead = (key: string) => key.endsWith("-1.png");
  const store = {
    async put() {},
    async deleteMap() {},
    async get(_map: string, key: string) {
      reads.push(key);
      if (isAhead(key)) {
        assert.equal(screenLoading, 0, "nothing ahead starts while the screen loads");
        aheadPeak = Math.max(aheadPeak, ++aheadActive);
      } else screenLoading++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (isAhead(key)) aheadActive--;
      else screenLoading--;
      if (broken.has(key)) throw new Error("unreadable");
      return blob;
    },
  };
  const cache = new TileCache(store, "ahead", () => repaints++, (message) => errors.push(message));
  const row = (y: number, length: number) => Array.from({ length }, (_, x) => ({ level: 0, x, y }));
  // Done once no tile has been read for a while.
  const settle = async () => {
    for (let i = 0, last = -1, still = 0; i < 500 && still < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      still = reads.length === last ? still + 1 : 0;
      last = reads.length;
    }
  };
  try {
    // Four on screen leave room for twenty ahead, of thirty offered.
    cache.plan(row(0, 4), () => row(1, 30));
    await settle();
    assert.equal(reads.filter(isAhead).length, 0, "the ring waits for a plan with the screen loading or done");
    assert.equal(repaints, 4);
    cache.plan(row(0, 4), () => row(1, 30));
    await settle();
    assert.equal(aheadPeak, 1, "one tile ahead at a time");
    assert.equal(repaints, 4, "tiles ahead don't repaint");
    assert.deepEqual(reads.filter(isAhead), row(1, 20).map((t) => tileKey(0, t.x, 1)), "nearest first, up to the budget");
    assert.equal(cache.decodedBytes, 23 * 1048576, "a broken tile ahead is skipped");
    assert.deepEqual(errors, [], "and not reported");
    cache.plan(row(0, 4), () => row(1, 30));
    await settle();
    assert.equal(reads.filter((key) => key === tileKey(0, 3, 1)).length, 1, "nor retried ahead");
    // The screen moves onto the ring: tiles ahead are already there, the broken one is read and reported.
    const before = reads.length;
    cache.plan(row(1, 4));
    await settle();
    assert.deepEqual(reads.slice(before), [tileKey(0, 3, 1)]);
    assert.equal(errors.length, 1);
    // A whole new screen pushes the tiles ahead out.
    cache.plan(row(2, 24));
    await settle();
    assert.equal(cache.complete, true);
    assert.ok(cache.decodedBytes <= TILE_CACHE_BUDGET);
  } finally {
    cache.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("shipped decoder is small and the app does not depend on a remote codec", async () => {
  const binary = await readFile(
    new URL("../public/codecs/jpeg.wasm", import.meta.url),
  );
  assert.ok(binary.byteLength < 300000);
});

test("CMYK JPEG scanlines convert Adobe ink channels to display RGBA", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-cmyk-"));
  await installPlatform(root);
  try {
    const file = new Blob([
      new Uint8Array(
        await readFile(new URL("./fixtures/cmyk.jpg", import.meta.url)),
      ),
    ]);
    const header = await readHeader(file),
      store = payloadStore("opfs");
    await store.put("cmyk", "original", file);
    let pixel: number[] = [];
    await decodeJPEG(
      file,
      header,
      "cmyk",
      "opfs",
      async (row) => {
        pixel = [...row.subarray(0, 4)];
      },
      jpegFactory,
    );
    assert.deepEqual(pixel, [245, 122, 0, 255]);
    await store.deleteMap("cmyk");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Cuts a fixture into level-0 tiles and decodes the whole original for comparison.
async function cutFixture(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-crop-"));
  await installPlatform(root);
  try {
    const file = new Blob([
      new Uint8Array(
        await readFile(new URL(`./fixtures/${name}`, import.meta.url)),
      ),
    ]);
    const header = await readHeader(file),
      store = payloadStore("opfs");
    await store.put("crop", "original", file);
    const original = new Uint8Array(header.width * header.height * 4);
    await decodeJPEG(
      file,
      header,
      "crop",
      "opfs",
      async (row, y) => original.set(row, y * header.width * 4),
      jpegFactory,
    );
    const tiles = new Map<string, Buffer>();
    const cut = await cropJPEG(
      file,
      header,
      "crop",
      async (x, y, tile) => {
        tiles.set(`${x}-${y}`, Buffer.from(await tile.arrayBuffer()));
      },
      jpegFactory,
    );
    // Scratch spill files are gone once cutting ends.
    assert.deepEqual(await readdir(path.join(root, "maps", "crop")), [
      "original",
    ]);
    return { file, header, original, tiles, cut };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
/** Largest channel difference from the original, split by distance to a cut. */
async function tileErrors(fixture: Awaited<ReturnType<typeof cutFixture>>) {
  const { header, original, tiles } = fixture;
  let inside = 0,
    nearCut = 0;
  for (const [key, bytes] of tiles) {
    const [tx, ty] = key.split("-").map(Number) as [number, number];
    const image = await loadImage(bytes),
      canvas = createCanvas(image.width, image.height),
      ctx = canvas.getContext("2d");
    assert.equal(
      image.width,
      Math.min(TILE_SIZE, header.width - tx * TILE_SIZE),
    );
    assert.equal(
      image.height,
      Math.min(TILE_SIZE, header.height - ty * TILE_SIZE),
    );
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const at =
            ((ty * TILE_SIZE + y) * header.width + tx * TILE_SIZE + x) * 4,
          cut =
            (tx > 0 && x < 2) ||
            (ty > 0 && y < 2) ||
            (x >= image.width - 2 && image.width === TILE_SIZE) ||
            (y >= image.height - 2 && image.height === TILE_SIZE);
        for (let c = 0; c < 4; c++) {
          const error = Math.abs(
            pixels[(y * image.width + x) * 4 + c]! - original[at + c]!,
          );
          if (cut) nearCut = Math.max(nearCut, error);
          else inside = Math.max(inside, error);
        }
      }
  }
  return { inside, nearCut };
}

test("JPEG originals are cut into exact JPEG tiles no bigger than the original", async () => {
  const fixture = await cutFixture("plan-444.jpg");
  assert.equal(fixture.cut, true);
  assert.deepEqual([...fixture.tiles.keys()], ["0-0", "1-0", "0-1", "1-1"]);
  for (const tile of fixture.tiles.values())
    assert.deepEqual([...tile.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual(await tileErrors(fixture), { inside: 0, nearCut: 0 });
  const bytes = [...fixture.tiles.values()].reduce(
    (n, tile) => n + tile.length,
    0,
  );
  assert.ok(bytes < fixture.file.size * 1.1);
});

// Chroma smoothing cannot reach across a cut, so only pixels next to one differ.
test("subsampled JPEG tiles keep chroma aligned away from cut edges", async () => {
  const fixture = await cutFixture("plan-420.jpg");
  assert.equal(fixture.cut, true);
  assert.equal((await tileErrors(fixture)).inside, 0);
});

test("CMYK JPEGs are not cut, so import decodes them instead", async () => {
  const fixture = await cutFixture("cmyk.jpg");
  assert.equal(fixture.cut, false);
  assert.equal(fixture.tiles.size, 0);
});

test("parent tiles are lossless PNG with an odd-width edge fully opaque", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-parents-"));
  await installPlatform(root);
  try {
    const store = payloadStore("opfs"),
      levels = pyramid(1025, 300);
    for (let x = 0; x < 3; x++) {
      const tile = createCanvas(x === 2 ? 1 : TILE_SIZE, 300),
        ctx = tile.getContext("2d");
      ctx.fillStyle = "#004488";
      ctx.fillRect(0, 0, tile.width, tile.height);
      await store.put(
        "edge",
        tileKey(0, x, 0),
        new Blob([new Uint8Array(await tile.encode("png"))]),
      );
    }
    const canvas = new OffscreenCanvas(1, 1);
    await buildParents(levels, canvas, store, "edge", () => {});
    const tile = await store.get("edge", tileKey(1, 1, 0)),
      bytes = new Uint8Array(await tile.arrayBuffer());
    // PNG, not JPEG: lossy parents of parents blur thin lines when zoomed out.
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const image = await loadImage(Buffer.from(bytes)),
      pixel = createCanvas(1, 1).getContext("2d");
    pixel.drawImage(image, 0, 0);
    assert.deepEqual([...pixel.getImageData(0, 0, 1, 1).data], [0x00, 0x44, 0x88, 0xff]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// JPEG drawn from JPEG blurs more at each level; drawn from PNG it is lossy once.
test("JPEG parent tiles are saved once from the sharp PNG level below", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-once-"));
  await installPlatform(root);
  try {
    const store = payloadStore("opfs"),
      levels = pyramid(1100, 600);
    assert.equal(levels.length, 3);
    for (let y = 0; y < levels[0]!.rows; y++)
      for (let x = 0; x < levels[0]!.cols; x++) {
        const tile = createCanvas(
            Math.min(TILE_SIZE, 1100 - x * TILE_SIZE),
            Math.min(TILE_SIZE, 600 - y * TILE_SIZE),
          ),
          ctx = tile.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, tile.width, tile.height);
        ctx.strokeStyle = "#c020ff";
        for (let line = 3; line < tile.width; line += 7) {
          ctx.beginPath();
          ctx.moveTo(line, 0);
          ctx.lineTo(tile.width - line, tile.height);
          ctx.stroke();
        }
        const bytes = new Uint8Array(await tile.encode("png"));
        for (const id of ["sharp", "once"])
          await store.put(id, tileKey(0, x, y), new Blob([bytes]));
      }
    await buildParents(levels, new OffscreenCanvas(1, 1), store, "sharp", () => {});
    await buildParents(levels, new OffscreenCanvas(1, 1), store, "once", () => {}, "image/jpeg");
    for (let index = 1; index < levels.length; index++)
      for (let y = 0; y < levels[index]!.rows; y++)
        for (let x = 0; x < levels[index]!.cols; x++) {
          const key = tileKey(index, x, y),
            sharp = await loadImage(Buffer.from(await (await store.get("sharp", key)).arrayBuffer())),
            canvas = createCanvas(sharp.width, sharp.height);
          canvas.getContext("2d").drawImage(sharp, 0, 0);
          const once = Buffer.from(await (await store.get("once", key)).arrayBuffer());
          assert.deepEqual(once, await canvas.encode("jpeg", 92), key);
        }
    // Level 0 stays as it was.
    const level0 = await (await store.get("once", tileKey(0, 0, 0))).arrayBuffer();
    assert.deepEqual([...new Uint8Array(level0, 0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
