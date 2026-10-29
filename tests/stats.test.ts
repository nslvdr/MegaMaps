import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { sendStats, setPerson, startStats, track } from "../src/stats";
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
const listeners = new Map<string, (event: unknown) => void>();
const page = { hidden: false, addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener) };
Object.assign(globalThis, {
  addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, listener),
  document: page,
  screen: { width: 412, height: 915 },
  fetch: async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return new Response(null, { status });
  },
});
startStats("2026.10.27");

const events = () => sent.flatMap((body) => body.batch);

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
  // The first launch on a device is the install.
  assert.deepEqual(sent[1]!.batch.map((entry) => entry.event), ["app_installed", "place_added", "trip_ended"]);
  const [, first, second] = sent[1]!.batch;
  assert.equal(first!.properties.app_version, "2026.10.27");
  assert.equal(first!.properties.distinct_id, second!.properties.distinct_id);
  // Used offline, even though it was sent online.
  assert.equal(first!.properties.online, false);
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

test("the person carries what the app knows about it alongside the nickname", async () => {
  online = true;
  await saveSetting("share-name", "Taupe");
  setPerson({ maps: 3 });
  track("measure_used");
  await sendStats();
  assert.deepEqual(sent.at(-1)!.batch[0]!.properties.$set, { maps: 3, name: "Taupe" });
});

test("a session lasts until the app is away for half an hour, and coming back after that counts", async (t) => {
  online = true;
  sent.length = 0;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  track("measure_used");
  // Away for a few minutes: the same session.
  page.hidden = true;
  listeners.get("visibilitychange")!({});
  t.mock.timers.tick(5 * 60_000);
  page.hidden = false;
  listeners.get("visibilitychange")!({});
  track("measure_used");
  // Away for an hour: a new one.
  page.hidden = true;
  listeners.get("visibilitychange")!({});
  t.mock.timers.tick(60 * 60_000);
  page.hidden = false;
  listeners.get("visibilitychange")!({});
  await sendStats();
  const [before, after, resumed] = events();
  assert.equal(before!.properties.$session_id, after!.properties.$session_id);
  assert.match(String(before!.properties.$session_id), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(resumed!.event, "app_resumed");
  assert.notEqual(resumed!.properties.$session_id, before!.properties.$session_id);
});

test("uncaught errors go to error tracking, up to a limit", async () => {
  online = true;
  sent.length = 0;
  listeners.get("error")!({ error: new TypeError("tiles is undefined") });
  for (let i = 0; i < 20; i++) listeners.get("unhandledrejection")!({ reason: "Quota exceeded" });
  await sendStats();
  const errors = events().filter((entry) => entry.event === "$exception");
  assert.equal(errors.length, 10);
  assert.deepEqual(errors[0]!.properties.$exception_list,
    [{ type: "TypeError", value: "tiles is undefined", mechanism: { handled: false, synthetic: false } }]);
});

test("a launch on a new version counts as an update", async () => {
  online = true;
  sent.length = 0;
  startStats("2026.11.01");
  await sendStats();
  const updated = events().find((entry) => entry.event === "app_updated");
  assert.equal(updated?.properties.from, "2026.10.27");
});
