import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { installPlatform, jpegFactory, nativeStats } from "./node-platform";
import { readHeader } from "../src/processing/headers";
import { decodeJPEG } from "../src/processing/jpeg";
import { tileBand, buildParents } from "../src/processing/tiles";
import { payloadStore } from "../src/storage/payloads";
import { pyramid, tileCount } from "../src/processing/pyramid";
import { TileCache, TILE_CACHE_BUDGET } from "../src/viewer/cache";
import { tileKey } from "../src/types";

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
