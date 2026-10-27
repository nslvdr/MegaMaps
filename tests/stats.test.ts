import test from "node:test";
import assert from "node:assert/strict";
import { setPreference } from "../src/preferences";
import { clearStats, sendStats, startStats, track } from "../src/stats";

let online = false;
const sent: { batch: { event: string; properties: Record<string, unknown> }[] }[] = [];
let status = 200;
Object.defineProperty(navigator, "onLine", { get: () => online, configurable: true });
Object.assign(globalThis, {
  addEventListener() {},
  document: { addEventListener() {} },
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

test("turned off, nothing is recorded, and turning back on starts a new anonymous id", async () => {
  online = true;
  track("measure_used");
  await sendStats();
  const before = sent[0]!.batch[0]!.properties.distinct_id;

  setPreference("usage-stats", "off");
  clearStats();
  track("measure_used");
  await sendStats();
  assert.equal(sent.length, 1);

  setPreference("usage-stats", "on");
  track("measure_used");
  await sendStats();
  assert.notEqual(sent[1]!.batch[0]!.properties.distinct_id, before);
});
