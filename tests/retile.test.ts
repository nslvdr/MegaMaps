import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { listMaps, removeRecord, saveMap } from "../src/storage/database";
import { startRetiling } from "../src/processing/retile";
import type { RetileReply, RetileRequest } from "../src/processing/retile.worker";
import { CHAINED_JPEG_PARENTS, CUT, DECODED, PNG_PARENTS, UNCUT } from "../src/processing/jpeg";
import type { MapRecord } from "../src/types";

const map = (id: string, decoder = DECODED): MapRecord => ({
  id, name: id, width: 600, height: 600, bytes: 1, backend: "opfs", levels: [],
  created: 0, status: "ready", decoder, tileBytes: 900,
});
/** Stands in for the retile worker: each map's reply, or silence to stay busy. */
function fakeWorkers(replies: Record<string, RetileReply | undefined>) {
  const sent: string[] = [], terminated: string[] = [];
  class FakeWorker {
    onmessage?: (event: { data: RetileReply }) => void;
    id = "";
    postMessage({ map }: RetileRequest) {
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
const done = (tileBytes: number): RetileReply => ({ type: "done", converted: true, tileBytes });
async function clear() {
  for (const { id } of await listMaps()) await removeRecord(id);
}

test("compact and older JPEG maps turn back into PNG tiles one by one, skipping busy maps and not retrying failures", async () => {
  await clear();
  for (const record of [map("sharp"), map("blurry", CHAINED_JPEG_PARENTS), map("large", PNG_PARENTS), map("compact", CUT), map("broken", CUT), map("failed", UNCUT), map("open", CUT), map("png", "PNG streaming scanlines")])
    await saveMap(record);
  const { sent, terminated } = fakeWorkers({
    blurry: done(1400), large: done(1500), compact: done(1800), broken: { type: "error", message: "" },
  });
  const replaced: string[] = [];
  await startRetiling((id) => id === "open", (id) => replaced.push(id)).done;
  assert.deepEqual(sent.sort(), ["blurry", "broken", "compact", "large"]);
  assert.deepEqual(terminated.sort(), ["blurry", "broken", "compact", "large"]);
  assert.deepEqual(replaced.sort(), ["blurry", "compact", "large"]);
  assert.deepEqual(await decoders(), {
    sharp: [DECODED, 900], blurry: [DECODED, 1400], large: [DECODED, 1500], compact: [DECODED, 1800],
    broken: [UNCUT, 900], failed: [UNCUT, 900], open: [CUT, 900], png: ["PNG streaming scanlines", 900],
  });
});

test("a stopped recut leaves its map to be recut again later", async () => {
  await clear();
  await saveMap(map("slow", CUT));
  const { terminated } = fakeWorkers({});
  const job = startRetiling(() => false, () => assert.fail("nothing was replaced"));
  while (job.mapId !== "slow") await new Promise((resolve) => setTimeout(resolve));
  await job.stop();
  assert.deepEqual(terminated, ["slow"]);
  assert.deepEqual((await decoders()).slow, [CUT, 900]);
});
