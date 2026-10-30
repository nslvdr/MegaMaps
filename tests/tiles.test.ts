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
    // Four on screen leave room for the rest of the budget ahead, of more offered.
    const room = TILE_CACHE_BUDGET / 1048576 - 4, offered = room + 10;
    cache.plan(row(0, 4), () => row(1, offered));
    await settle();
    assert.equal(reads.filter(isAhead).length, 0, "the ring waits for a plan with the screen loading or done");
    assert.equal(repaints, 4);
    cache.plan(row(0, 4), () => row(1, offered));
    await settle();
    assert.equal(aheadPeak, 1, "one tile ahead at a time");
    assert.equal(repaints, 4, "tiles ahead don't repaint");
    assert.deepEqual(reads.filter(isAhead), row(1, room).map((t) => tileKey(0, t.x, 1)), "nearest first, up to the budget");
    assert.equal(cache.decodedBytes, (3 + room) * 1048576, "a broken tile ahead is skipped");
    assert.deepEqual(errors, [], "and not reported");
    cache.plan(row(0, 4), () => row(1, offered));
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

test("while the screen loads, the parents of its missing tiles load first, and decodes it moved past stay", async () => {
  const canvas = createCanvas(512, 512);
  const blob = new Blob([new Uint8Array(await canvas.encode("png"))]);
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-parents-"));
  await installPlatform(root);
  const reads: string[] = [];
  const store = {
    async put() {},
    async deleteMap() {},
    async get(_map: string, key: string) {
      reads.push(key);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return blob;
    },
  };
  const cache = new TileCache(store, "parents", () => {}, (message) => assert.fail(message));
  const row = (level: number, y: number, from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => ({ level, x: from + i, y }));
  const settle = async () => {
    for (let i = 0, last = -1, still = 0; i < 500 && still < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      still = reads.length === last ? still + 1 : 0;
      last = reads.length;
    }
  };
  const keys = (tiles: { level: number; x: number; y: number }[]) => tiles.map((t) => tileKey(t.level, t.x, t.y));
  try {
    cache.plan(row(0, 0, 0, 4), undefined, 3);
    await settle();
    assert.deepEqual(reads, keys([...row(1, 0, 0, 2), ...row(0, 0, 0, 4)]));
    // Only the new tiles' parent loads first. Zooming out mid-load leaves both
    // decodes in flight to finish and stay; the overview's level loads no parents.
    cache.plan(row(0, 0, 0, 6), undefined, 3);
    cache.plan(row(1, 0, 0, 4), undefined, 2);
    await settle();
    assert.deepEqual(reads.slice(6), keys([{ level: 1, x: 2, y: 0 }, { level: 0, x: 4, y: 0 }, { level: 1, x: 3, y: 0 }]));
    assert.equal(cache.complete, true);
    assert.ok(cache.tiles.some((t) => t.level === 0 && t.x === 4), "the decode the camera moved past stays");
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

test("JPEG maps up to 600 megapixels pass the header and decoder checks", async () => {
  const small = new Uint8Array(await createCanvas(8, 8).encode("jpeg"));
  // Rewrite the frame size; nothing past the header is decoded.
  const sized = (width: number, height: number) => {
    const bytes = small.slice(),
      view = new DataView(bytes.buffer);
    let p = 2;
    while (bytes[p + 1] !== 0xc0) p += 2 + view.getUint16(p + 2);
    view.setUint16(p + 5, height);
    view.setUint16(p + 7, width);
    return bytes;
  };
  const open = async (bytes: Uint8Array) => {
    const module = await (await jpegFactory())({
      locateFile: (file) => file,
      readInput(offset, destination) {
        const count = Math.min(destination.length, bytes.length - offset);
        destination.set(bytes.subarray(offset, offset + count));
        return count;
      },
    });
    const width = module._decoder_open();
    return width ? width : module.UTF8ToString(module._decoder_error());
  };
  const large = sized(32000, 18000);
  assert.equal((await readHeader(new Blob([large]))).width, 32000);
  assert.equal(await open(large), 32000);
  const tooLarge = sized(32000, 19000);
  await assert.rejects(readHeader(new Blob([tooLarge])), /600 megapixel/);
  assert.match(String(await open(tooLarge)), /exceeds supported dimensions/);
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
