import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { sendStats, startStats, track } from "../src/stats";
import { saveSetting } from "../src/storage/settings";

let online = false;
const sent: { batch: { event: string; properties: Record<string, unknown> }[] }[] = [];
let status = 200;
Object.defineProperty(navigator, "onLine", { get: () => online, configurable: true });
// Chrome on an Android phone: the user agent hides the model, the client hints give it.
Object.defineProperties(navigator, {
  userAgent: { value: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36" },
  userAgentData: { value: { platform: "Android", brands: [],
    getHighEntropyValues: async () => ({ model: "Pixel 8", platformVersion: "15.0.0" }) } },
});
Object.assign(globalThis, {
  addEventListener() {},
  document: { addEventListener() {} },
  screen: { width: 412, height: 915 },
  fetch: async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return new Response(null, { status });
  },
});
startStats("2026.10.27");

test("events wait offline, go out once in one batch, and stay when the server is busy", async () => {
  track("place_added", { kind: "pillar" });
  track("trip_ended", { minutes: 42 });
  await sendStats();
  assert.equal(sent.length, 0);

  online = true;
  status = 503;
  await sendStats();
  status = 200;
  await sendStats();
  await sendStats();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1]!.batch.map((entry) => entry.event), ["place_added", "trip_ended"]);
  const [first, second] = sent[1]!.batch;
  assert.equal(first!.properties.app_version, "2026.10.27");
  assert.equal(first!.properties.distinct_id, second!.properties.distinct_id);
  sent.length = 0;
});

test("events name the phone, and the person by their Settings nickname until it's cleared", async () => {
  online = true;
  await saveSetting("share-name", "Taupe");
  track("measure_used");
  await sendStats();
  const named = sent.at(-1)!.batch[0]!.properties;
  assert.equal(named.$os, "Android");
  assert.equal(named.$os_version, "15.0.0");
  assert.equal(named.$device_model, "Pixel 8");
  assert.equal(named.$device_type, "Mobile");
  assert.equal(named.$browser, "Chrome");
  assert.deepEqual(named.$set, { name: "Taupe" });

  await saveSetting("share-name", "");
  track("measure_used");
  await sendStats();
  assert.deepEqual(sent.at(-1)!.batch[0]!.properties.$unset, ["name"]);
});
