import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { startOcrEngines } from "../src/ocr/engines";
import { OcrTileCache, OCR_TILE_CACHE_BYTES } from "../src/ocr/tiles";
import { ocrCrops, scanMap } from "../src/ocr/scan";
import { tileKey, type MapRecord } from "../src/types";
import type { PayloadStore } from "../src/storage/payloads";
import { installPlatform, nativeStats } from "./node-platform";

const map: MapRecord = {
  id: "ocr-cache-test",
  name: "fixture",
  width: 2560,
  height: 2560,
  bytes: 1,
  backend: "indexeddb",
  levels: [],
  created: 1,
  status: "ready",
};

test("concurrent OCR startup waits for both engines and releases a late success after failure", async () => {
  for (const failed of ["recognizer", "detector"]) {
    const error = new Error(`${failed} failed`);
    let finish!: () => void;
    let closed = false;
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = startOcrEngines(
      failed === "recognizer"
        ? Promise.reject(error)
        : late.then(() => ({
            terminate: async () => {
              closed = true;
            },
          })),
      failed === "detector"
        ? Promise.reject(error)
        : late.then(() => ({
            dispose: async () => {
              closed = true;
            },
          })),
    );
    assert.equal(closed, false);
    finish();
    await assert.rejects(pending, (cause) => cause === error);
    assert.equal(closed, true);
  }
  const reader = { terminate: async () => {} };
  const finder = { dispose: async () => {} };
  assert.deepEqual(
    await startOcrEngines(Promise.resolve(reader), Promise.resolve(finder)),
    { recognizer: reader, detector: finder },
  );
  const startup = new Error("startup");
  await assert.rejects(
    startOcrEngines(
      Promise.reject(startup),
      Promise.resolve({
        dispose: async () => {
          throw new Error("cleanup");
        },
      }),
    ),
    (cause) => cause === startup,
  );
});

test("OCR tile cache reuses and refreshes tiles, reserves decode memory, and closes aborted decodes", async () => {
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  const abort = new AbortController();
  let live = 0,
    peak = 0,
    reads = 0,
    cancelOnDecode = false;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => {
      live += 512 * 512 * 4;
      peak = Math.max(peak, live);
      if (cancelOnDecode) abort.abort();
      let closed = false;
      return {
        width: 512,
        height: 512,
        close() {
          if (!closed) {
            live -= 512 * 512 * 4;
            closed = true;
          }
        },
      };
    },
  });
  const store: PayloadStore = {
    put: async () => {},
    deleteMap: async () => {},
    get: async () => {
      reads++;
      return new Blob();
    },
  };
  const cache = new OcrTileCache(map, store, abort.signal);
  try {
    const first = await cache.get(0, 0);
    for (let x = 1; x < 4; x++) await cache.get(x, 0);
    assert.equal(await cache.get(0, 0), first);
    await cache.get(4, 0);
    assert.equal(
      await cache.get(0, 0),
      first,
      "a recently used tile survives eviction",
    );
    await cache.get(1, 0);
    assert.equal(reads, 6, "the oldest tile is decoded again after eviction");
    cancelOnDecode = true;
    await assert.rejects(cache.get(5, 0), { name: "AbortError" });
    assert.ok(peak <= OCR_TILE_CACHE_BYTES);
  } finally {
    cache.dispose();
    cache.dispose();
    if (previous)
      Object.defineProperty(globalThis, "createImageBitmap", previous);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
  }
  assert.equal(live, 0);
});

test("overlapping OCR sections keep exact pixels, reuse decodes and release the cache on every exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocr-tiles-"));
  await installPlatform(root);
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: class {
      constructor(width: number, height: number) {
        return createCanvas(width, height);
      }
    },
  });
  const blobs = new Map<string, Blob>();
  for (let x = 0; x < 5; x++)
    for (let y = 0; y < 5; y++) {
      const tile = createCanvas(512, 512),
        ctx = tile.getContext("2d");
      const gray = 170 + (x + y) * 5;
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(0, 0, 512, 512);
      blobs.set(
        tileKey(0, x, y),
        new Blob([new Uint8Array(await tile.encode("png"))]),
      );
    }
  let reads = 0;
  const store: PayloadStore = {
    put: async () => {},
    deleteMap: async () => {},
    async get(_id, key) {
      reads++;
      const blob = blobs.get(key);
      if (!blob) throw new Error("missing tile");
      return blob;
    },
  };
  const crops = ocrCrops(map.width, map.height);
  const uncachedReads = crops.reduce(
    (count, crop) =>
      count +
      (Math.ceil((crop.x + crop.width) / 512) - Math.floor(crop.x / 512)) *
        (Math.ceil((crop.y + crop.height) / 512) - Math.floor(crop.y / 512)),
    0,
  );
  nativeStats.peakDecodedBytes = 0;
  let section = 0;
  try {
    const started = performance.now();
    await scanMap(
      map,
      store,
      async (image) => {
        const crop = crops[section++]!;
        const ctx = image.getContext("2d")!;
        for (const [x, y] of [
          [0, 0],
          [image.width - 1, image.height - 1],
          [512, 256],
        ]) {
          const gray =
            170 +
            (Math.floor((crop.x + x!) / 512) +
              Math.floor((crop.y + y!) / 512)) *
              5;
          assert.deepEqual(
            [...ctx.getImageData(x!, y!, 1, 1).data],
            [gray, gray, gray, 255],
          );
        }
        return [];
      },
      async () => {
        throw new Error("empty regions should not reach OCR");
      },
      () => {},
      new AbortController().signal,
    );
    if (process.env.OCR_BENCHMARK)
      console.log(
        "OCR_BENCHMARK",
        JSON.stringify({
          fixture: "tile-cache",
          ms: performance.now() - started,
          sections: crops.length,
          tileDecodes: reads,
          uncachedTileDecodes: uncachedReads,
          peakDecodedBytes: nativeStats.peakDecodedBytes,
        }),
      );
    assert.equal(section, crops.length);
    assert.ok(
      reads < uncachedReads,
      `${reads} cached reads vs ${uncachedReads} uncached`,
    );
    assert.ok(nativeStats.peakDecodedBytes <= OCR_TILE_CACHE_BYTES);
    assert.equal(nativeStats.decodedBytes, 0);
    const abort = new AbortController();
    await assert.rejects(
      scanMap(
        map,
        store,
        async () => {
          abort.abort();
          return [];
        },
        async () => ({ blocks: null, confidence: 0 }),
        () => {},
        abort.signal,
      ),
      { name: "AbortError" },
    );
    assert.equal(nativeStats.decodedBytes, 0);
    blobs.delete(tileKey(0, 1, 0));
    await assert.rejects(
      scanMap(
        map,
        store,
        async () => [],
        async () => ({ blocks: null, confidence: 0 }),
        () => {},
        new AbortController().signal,
      ),
      /missing tile/,
    );
    assert.equal(nativeStats.decodedBytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
