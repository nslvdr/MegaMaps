import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { installPlatform } from "./node-platform";
import { listMaps, saveMap } from "../src/storage/database";
import type { MapRecord, WorkerReply } from "../src/types";

interface ImportRequest {
  file: File;
  record: MapRecord;
}
const context = globalThis as unknown as {
  onmessage: (event: MessageEvent<ImportRequest>) => Promise<void>;
};

async function importJPEG(messages: WorkerReply[], id: string, width: number, height: number) {
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").fillRect(0, 0, width, height);
  const file = new File([new Uint8Array(await canvas.encode("jpeg"))], `${id}.jpg`);
  const record: MapRecord = { id, name: file.name, width, height, bytes: file.size,
    backend: "indexeddb", levels: [], created: 0, status: "importing" };
  await saveMap(record);
  messages.length = 0;
  await context.onmessage(new MessageEvent<ImportRequest>("message", { data: { file, record } }));
  return messages.at(-1);
}

test("without WebAssembly, JPEG maps use the browser's decoder and larger ones say why they can't", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-no-wasm-"));
  await installPlatform(root);
  const messages: WorkerReply[] = [];
  for (const handler of ["onmessage", "onunhandledrejection"])
    Object.defineProperty(globalThis, handler, { value: null, writable: true, configurable: true });
  Object.defineProperty(globalThis, "postMessage", {
    value: (message: WorkerReply) => messages.push(message), writable: true, configurable: true,
  });
  const wasm = Object.getOwnPropertyDescriptor(globalThis, "WebAssembly")!;
  Object.defineProperty(globalThis, "WebAssembly", { value: undefined, configurable: true });
  try {
    await import("../src/processing/import.worker");
    assert.equal((await importJPEG(messages, "small", 600, 400))?.type, "done");
    const map = (await listMaps()).find((item) => item.id === "small")!;
    assert.equal(map.status, "ready");
    assert.equal(map.decoder, "size-limited native bitmap");

    const refused = await importJPEG(messages, "large", 4001, 4001);
    assert.equal(refused?.type, "error");
    assert.match(refused?.type === "error" ? refused.message : "", /WebAssembly turned off/);
  } finally {
    Object.defineProperty(globalThis, "WebAssembly", wasm);
    await rm(root, { recursive: true, force: true });
  }
});
