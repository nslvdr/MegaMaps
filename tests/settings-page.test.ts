import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { DEBUG_HOLD, ERASE_STEP_PAUSE, eraseDialogMarkup, initSettingsPage, resetMarkup, restoreDialogMarkup, settingsMarkup } from "../src/ui/settings-page";
import { saveMap } from "../src/storage/database";
import { payloadStore } from "../src/storage/payloads";
import { deleteMapPhotos, savePhoto } from "../src/storage/photos";
import type { MapRecord } from "../src/types";
import { preference } from "../src/preferences";

for (const [what, row, actions, last] of [
  ["data", "#reset-data", ["Continue", "Delete all data", "Delete forever"], /delete 1 map from this device/],
  ["app", "#reset-app", ["Continue", "Reset the app", "Reset now"], /delete 1 map and reset Mega Maps/],
] as const)
  test(`Reset's ${actions[1]} takes three separate confirmations, each after a pause`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { window, document } = parseHTML(`<html><body>${settingsMarkup}${resetMarkup}${restoreDialogMarkup}${eraseDialogMarkup}</body></html>`);
    Object.defineProperty(globalThis, "window", { value: { ...globalThis, scrollTo() {} }, configurable: true });
    const dialog = document.querySelector<HTMLDialogElement>("#erase-dialog")!;
    // Linkedom omits native dialog behavior.
    for (const element of document.querySelectorAll<HTMLDialogElement>("dialog"))
      Object.defineProperties(element, {
        showModal: { value: () => element.setAttribute("open", "") },
        close: { value: () => {
          element.removeAttribute("open");
          element.dispatchEvent(new window.Event("close"));
        } },
      });
    await saveMap({ id: "quarry", name: "Quarry", width: 1, height: 1, bytes: 0, backend: "indexeddb",
      levels: [], created: 1, status: "ready" } satisfies MapRecord);
    const erased: string[] = [];
    const settings = document.querySelector<HTMLElement>("#settings")!, reset = document.querySelector<HTMLElement>("#reset")!;
    initSettingsPage(settings, { reset, restore: document.querySelector("#restore-dialog")!, erase: dialog }, {
      back() {}, checkUpdates() {}, openWhatsNew() {}, restore() {}, setLabelSize() {}, erase: (what) => { erased.push(what); },
    });
    const confirm = document.querySelector<HTMLButtonElement>("#erase-confirm")!;
    const step = () => document.querySelector("#erase-step")!.textContent;

    settings.hidden = false;
    document.querySelector<HTMLButtonElement>("#settings-erase")!.click();
    assert.ok(settings.hidden && !reset.hidden, "Reset opens as a page of its own");
    document.querySelector<HTMLButtonElement>(row)!.click();
    for (let turn = 0; turn < 100 && !dialog.hasAttribute("open"); turn++) await new Promise(setImmediate);
    assert.ok(dialog.hasAttribute("open"));
    assert.equal(document.querySelector("#erase-title")!.textContent, actions[1]);
    for (const [index, action] of actions.entries()) {
      assert.equal(step(), `Step ${index + 1} of 3`);
      assert.equal(confirm.textContent, action);
      confirm.click();
      assert.equal(step(), `Step ${index + 1} of 3`, "a hurried tap does nothing");
      t.mock.timers.tick(ERASE_STEP_PAUSE);
      if (index < 2) confirm.click();
    }
    assert.match(document.querySelector("#erase-summary")!.textContent!, last);
    assert.deepEqual(erased, [], "nothing is deleted before the last confirmation");
    confirm.click();
    assert.deepEqual(erased, [what]);
    assert.ok(!dialog.hasAttribute("open"));
    assert.ok(!settings.hidden && reset.hidden, "Settings shows again");
  });

test("Settings warns and says so beside the storage size when the browser may clear the library", async () => {
  const { document } = parseHTML(`<html><body>${settingsMarkup}${resetMarkup}${restoreDialogMarkup}${eraseDialogMarkup}</body></html>`);
  const storage = Object.getOwnPropertyDescriptor(navigator, "storage");
  Object.defineProperty(navigator, "storage", { configurable: true, value: {
    estimate: async () => ({ usage: 2048, quota: 1e9 }), persisted: async () => false,
  } });
  try {
    const page = initSettingsPage(document.querySelector("#settings")!, {
      reset: document.querySelector("#reset")!, restore: document.querySelector("#restore-dialog")!, erase: document.querySelector("#erase-dialog")!,
    }, { back() {}, checkUpdates() {}, openWhatsNew() {}, restore() {}, setLabelSize() {}, erase() {} });
    await page.refresh();
    assert.match(document.querySelector("#settings-storage-status")!.textContent!, /· Not protected$/);
    assert.match(document.querySelector("#backup-note")!.textContent!, /^This browser may clear your maps when the device runs low on space\. /);
  } finally {
    if (storage) Object.defineProperty(navigator, "storage", storage);
    else delete (navigator as { storage?: unknown }).storage;
  }
});

test("the storage size follows what is stored, not the browser's lagging estimate", async () => {
  const { document } = parseHTML(`<html><body>${settingsMarkup}${resetMarkup}${restoreDialogMarkup}${eraseDialogMarkup}</body></html>`);
  const storage = Object.getOwnPropertyDescriptor(navigator, "storage");
  Object.defineProperty(navigator, "storage", { configurable: true, value: {
    estimate: async () => ({ usage: 50 * 1024 * 1024, quota: 1e9 }),
  } });
  try {
    const page = initSettingsPage(document.querySelector("#settings")!, {
      reset: document.querySelector("#reset")!, restore: document.querySelector("#restore-dialog")!, erase: document.querySelector("#erase-dialog")!,
    }, { back() {}, checkUpdates() {}, openWhatsNew() {}, restore() {}, setLabelSize() {}, erase() {} });
    const size = () => document.querySelector("#settings-storage-status")!.textContent;
    await page.refresh();
    const before = size();
    assert.equal(before, "<1 KB");
    await payloadStore("indexeddb").put("usage", "tile", new Blob([new Uint8Array(300 * 1024)]));
    await savePhoto("usage", new Blob([new Uint8Array(200 * 1024)]));
    await page.refresh();
    assert.equal(size(), "500 KB");
    await payloadStore("indexeddb").deleteMap("usage");
    await deleteMapPhotos("usage");
    await page.refresh();
    assert.equal(size(), before);
  } finally {
    if (storage) Object.defineProperty(navigator, "storage", storage);
    else delete (navigator as { storage?: unknown }).storage;
  }
});

test("holding Check for updates turns the debug overlay on and off instead of checking", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { window, document } = parseHTML(`<html><body>${settingsMarkup}${resetMarkup}${restoreDialogMarkup}${eraseDialogMarkup}</body></html>`);
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  let checks = 0;
  initSettingsPage(document.querySelector("#settings")!, {
    reset: document.querySelector("#reset")!, restore: document.querySelector("#restore-dialog")!, erase: document.querySelector("#erase-dialog")!,
  }, { back() {}, checkUpdates: () => { checks++; }, openWhatsNew() {}, restore() {}, setLabelSize() {}, erase() {} });
  const row = document.querySelector<HTMLButtonElement>("#settings-update")!;
  const press = (duration: number) => {
    row.dispatchEvent(new window.Event("pointerdown"));
    t.mock.timers.tick(duration);
    row.dispatchEvent(new window.Event("pointerup"));
    row.click();
  };
  try {
    press(DEBUG_HOLD - 100);
    assert.equal(checks, 1, "a tap checks for updates");
    assert.equal(preference("debug"), "off");
    press(DEBUG_HOLD);
    assert.equal(preference("debug"), "on");
    assert.equal(document.querySelector("#settings-update-status")!.textContent, "Debug overlay on");
    assert.equal(checks, 1, "a hold doesn't check");
    press(DEBUG_HOLD);
    assert.equal(preference("debug"), "off");
  } finally {
    localStorage.removeItem("megamaps:debug");
  }
});
