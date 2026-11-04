import "fake-indexeddb/auto";
import { $, click, fire, render, settle } from "./dom";
import test from "node:test";
import assert from "node:assert/strict";
import Settings, { DEBUG_HOLD, ERASE_STEP_PAUSE } from "../src/ui/Settings.svelte";
import { saveMap } from "../src/storage/database";
import { payloadStore } from "../src/storage/payloads";
import { deleteMapPhotos, savePhoto } from "../src/storage/photos";
import type { MapRecord } from "../src/types";
import { preference } from "../src/preferences";

const options = {
  back() {}, checkUpdates() {}, openWhatsNew() {}, restore() {}, setLabelSize() {}, erase() {},
};

/** The browser's storage answers, for the length of a test. */
function storage(t: test.TestContext, value: Partial<StorageManager>) {
  const before = Object.getOwnPropertyDescriptor(navigator, "storage");
  Object.defineProperty(navigator, "storage", { configurable: true, value });
  t.after(() => {
    if (before) Object.defineProperty(navigator, "storage", before);
    else delete (navigator as { storage?: unknown }).storage;
  });
}

for (const [what, row, actions, last] of [
  ["data", "reset-data", ["Continue", "Delete all data", "Delete forever"], /delete 1 map from this device/],
  ["app", "reset-app", ["Continue", "Reset the app", "Reset now"], /delete 1 map and reset Mega Maps/],
] as const)
  test(`Reset's ${actions[1]} takes three separate confirmations, each after a pause`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await saveMap({ id: "quarry", name: "Quarry", width: 1, height: 1, bytes: 0, backend: "indexeddb",
      levels: [], created: 1, status: "ready" } satisfies MapRecord);
    const erased: string[] = [];
    const { instance, destroy } = render(Settings, { ...options, erase: (what) => { erased.push(what); } });
    t.after(destroy);
    const dialog = $<HTMLDialogElement>("erase-dialog"), confirm = $<HTMLButtonElement>("erase-confirm");
    const step = () => $("erase-step").textContent;

    instance.open();
    await settle();
    click("settings-erase");
    assert.ok($("settings").hidden && !$("reset").hidden, "Reset opens as a page of its own");
    click(row);
    for (let turn = 0; turn < 100 && !dialog.open; turn++) await settle();
    assert.ok(dialog.open);
    assert.equal($("erase-title").textContent, actions[1]);
    for (const [index, action] of actions.entries()) {
      assert.equal(step(), `Step ${index + 1} of 3`);
      assert.equal(confirm.textContent!.trim(), action);
      click(confirm);
      assert.equal(step(), `Step ${index + 1} of 3`, "a hurried tap does nothing");
      t.mock.timers.tick(ERASE_STEP_PAUSE);
      await settle();
      if (index < 2) click(confirm);
    }
    assert.match($("erase-summary").textContent!, last);
    assert.deepEqual(erased, [], "nothing is deleted before the last confirmation");
    click(confirm);
    assert.deepEqual(erased, [what]);
    assert.ok(!dialog.open);
    assert.ok(!$("settings").hidden && $("reset").hidden, "Settings shows again");
  });

test("Settings warns and says so beside the storage size when the browser may clear the library", async (t) => {
  storage(t, { estimate: async () => ({ usage: 2048, quota: 1e9 }), persisted: async () => false });
  const { instance, destroy } = render(Settings, options);
  t.after(destroy);
  await instance.refresh();
  await settle();
  assert.match($("settings-storage-status").textContent!, /· Not protected$/);
  assert.match($("backup-note").textContent!, /^This browser may clear your maps when the device runs low on space\. /);
});

test("the storage size follows what is stored, not the browser's lagging estimate", async (t) => {
  storage(t, { estimate: async () => ({ usage: 50 * 1024 * 1024, quota: 1e9 }) });
  const { instance, destroy } = render(Settings, options);
  t.after(destroy);
  const size = async () => {
    await instance.refresh();
    await settle();
    return $("settings-storage-status").textContent;
  };
  const before = await size();
  assert.equal(before, "<1 KB");
  await payloadStore("indexeddb").put("usage", "tile", new Blob([new Uint8Array(300 * 1024)]));
  await savePhoto("usage", new Blob([new Uint8Array(200 * 1024)]));
  assert.equal(await size(), "500 KB");
  await payloadStore("indexeddb").deleteMap("usage");
  await deleteMapPhotos("usage");
  assert.equal(await size(), before);
});

test("holding Check for updates turns the debug overlay on and off instead of checking", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let checks = 0;
  const { destroy } = render(Settings, { ...options, checkUpdates: () => { checks++; } });
  t.after(() => {
    destroy();
    localStorage.removeItem("megamaps:debug");
  });
  const press = (duration: number) => {
    fire("settings-update", "pointerdown");
    t.mock.timers.tick(duration);
    fire("settings-update", "pointerup");
    click("settings-update");
  };
  press(DEBUG_HOLD - 100);
  assert.equal(checks, 1, "a tap checks for updates");
  assert.equal(preference("debug"), "off");
  press(DEBUG_HOLD);
  assert.equal(preference("debug"), "on");
  assert.equal($("settings-update-status").textContent, "Debug overlay on");
  assert.equal(checks, 1, "a hold doesn't check");
  press(DEBUG_HOLD);
  assert.equal(preference("debug"), "off");
});
