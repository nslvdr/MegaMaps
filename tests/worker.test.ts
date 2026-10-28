import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { installPlatform } from "./node-platform";
import { saveMap, listMaps } from "../src/storage/database";
import { deleteStoredMap, payloadStore } from "../src/storage/payloads";
import { tileKey, type MapRecord, type WorkerReply } from "../src/types";
interface ImportRequest {
  file: File;
  record: MapRecord;
}
const context = globalThis as unknown as {
  onmessage: (event: MessageEvent<ImportRequest>) => Promise<void>;
  postMessage: (message: WorkerReply) => void;
};

test("worker commits ready only after all tiles, and malformed imports remain recoverable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-worker-"));
  await installPlatform(root);
  const messages: WorkerReply[] = [];
  for (const handler of ["onmessage", "onunhandledrejection"])
    Object.defineProperty(globalThis, handler, {
      value: null,
      writable: true,
      configurable: true,
    });
  Object.defineProperty(globalThis, "postMessage", {
    value: (message: WorkerReply) => messages.push(message),
    writable: true,
    configurable: true,
  });
  try {
    await import("../src/processing/import.worker");
    const canvas = createCanvas(1025, 777);
    canvas.getContext("2d").fillRect(0, 0, 1025, 777);
    const file = new File(
      [new Uint8Array(await canvas.encode("png"))],
      "local.png",
    );
    const record: MapRecord = {
      id: "worker",
      name: file.name,
      width: 1025,
      height: 777,
      bytes: file.size,
      backend: "indexeddb",
      levels: [],
      created: 0,
      status: "importing",
    };
    await saveMap(record);
    await context.onmessage(
      new MessageEvent<ImportRequest>("message", { data: { file, record } }),
    );
    assert.equal(messages.at(-1)?.type, "done");
    const ready = (await listMaps()).find((map) => map.id === "worker")!;
    assert.equal(ready.status, "ready");
    assert.ok(ready.importMs! > 0);
    assert.ok(ready.tileBytes! > 0);
    for (let l = 0; l < ready.levels.length; l++)
      for (let y = 0; y < ready.levels[l]!.rows; y++)
        for (let x = 0; x < ready.levels[l]!.cols; x++)
          assert.ok(
            (await payloadStore(ready.backend).get(ready.id, tileKey(l, x, y)))
              .size > 0,
          );
    await deleteStoredMap(ready);
    messages.length = 0;
    const damaged = new File(
      [new Uint8Array(await file.arrayBuffer()).subarray(0, 40)],
      "damaged.png",
    );
    const failed = { ...record, id: "failed", name: damaged.name };
    await saveMap(failed);
    await context.onmessage(
      new MessageEvent<ImportRequest>("message", {
        data: { file: damaged, record: failed },
      }),
    );
    assert.equal(messages.at(-1)?.type, "error");
    assert.equal(
      (await listMaps()).find((map) => map.id === "failed")?.status,
      "importing",
    );
    await deleteStoredMap(failed);
    assert.ok(!(await listMaps()).some((map) => map.id === "failed"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
