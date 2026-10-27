import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { listMaps, saveMap } from "../src/storage/database";
import { startShrinking } from "../src/processing/shrink";
import type { ShrinkReply } from "../src/processing/shrink.worker";
import { CUT, DECODED, UNCUT } from "../src/processing/jpeg";
import type { MapRecord } from "../src/types";

const map = (id: string, decoder = DECODED): MapRecord => ({
  id, name: id, width: 600, height: 600, bytes: 1, backend: "opfs", levels: [],
  created: 0, status: "ready", decoder, tileBytes: 900,
});
/** Stands in for the shrink worker: each map's reply, or silence to stay busy. */
function fakeWorkers(replies: Record<string, ShrinkReply | undefined>) {
  const sent: string[] = [], terminated: string[] = [];
  class FakeWorker {
    onmessage?: (event: { data: ShrinkReply }) => void;
    id = "";
    postMessage(map: MapRecord) {
      this.id = map.id;
      sent.push(map.id);
      const reply = replies[map.id];
      if (reply) queueMicrotask(() => this.onmessage?.({ data: reply }));
    }
    terminate() {
      terminated.push(this.id);
    }
  }
  Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true });
  return { sent, terminated };
}
const decoders = async () =>
  Object.fromEntries((await listMaps()).map((map) => [map.id, [map.decoder, map.tileBytes]]));

test("older JPEG maps are recut one by one, skipping busy maps and not retrying failures", async () => {
  for (const record of [map("old"), map("cmyk"), map("open"), map("png", "PNG streaming scanlines")])
    await saveMap(record);
  const { sent, terminated } = fakeWorkers({
    old: { type: "done", cut: true, tileBytes: 300 },
    cmyk: { type: "done", cut: false, tileBytes: 0 },
  });
  const replaced: string[] = [];
  await startShrinking((id) => id === "open", (id) => replaced.push(id)).done;
  assert.deepEqual(sent.sort(), ["cmyk", "old"]);
  assert.deepEqual(terminated.sort(), ["cmyk", "old"]);
  assert.deepEqual(replaced, ["old"]);
  assert.deepEqual(await decoders(), {
    old: [CUT, 300], cmyk: [UNCUT, 900], open: [DECODED, 900], png: ["PNG streaming scanlines", 900],
  });
});

test("a stopped shrink leaves its map to be cut again later", async () => {
  await saveMap(map("slow"));
  const { terminated } = fakeWorkers({});
  const job = startShrinking((id) => id !== "slow", () => assert.fail("nothing was replaced"));
  while (job.mapId !== "slow") await new Promise((resolve) => setTimeout(resolve));
  await job.stop();
  assert.deepEqual(terminated, ["slow"]);
  assert.deepEqual((await decoders()).slow, [DECODED, 900]);
});
