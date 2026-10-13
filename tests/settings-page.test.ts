import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ERASE_STEP_PAUSE, eraseDialogMarkup, initSettingsPage, restoreDialogMarkup, settingsMarkup } from "../src/ui/settings-page";
import { saveMap } from "../src/storage/database";
import type { MapRecord } from "../src/types";

test("deleting everything takes three separate confirmations, each after a pause", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { window, document } = parseHTML(`<html><body>${settingsMarkup}${restoreDialogMarkup}${eraseDialogMarkup}</body></html>`);
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
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
  let erased = 0;
  initSettingsPage(document.querySelector("#settings")!, { restore: document.querySelector("#restore-dialog")!, erase: dialog }, {
    back() {}, checkUpdates() {}, restore() {}, setLabelSize() {}, erase: () => { erased++; },
  });
  const confirm = document.querySelector<HTMLButtonElement>("#erase-confirm")!;
  const step = () => document.querySelector("#erase-step")!.textContent;

  document.querySelector<HTMLButtonElement>("#settings-erase")!.click();
  for (let turn = 0; turn < 100 && !dialog.hasAttribute("open"); turn++) await new Promise(setImmediate);
  assert.ok(dialog.hasAttribute("open"));
  for (const [number, action] of [[1, "Continue"], [2, "Delete everything"], [3, "Delete forever"]] as const) {
    assert.equal(step(), `Step ${number} of 3`);
    assert.equal(confirm.textContent, action);
    confirm.click();
    assert.equal(step(), `Step ${number} of 3`, "a hurried tap does nothing");
    t.mock.timers.tick(ERASE_STEP_PAUSE);
    if (number < 3) confirm.click();
  }
  assert.match(document.querySelector("#erase-summary")!.textContent!, /delete 1 map/);
  assert.equal(erased, 0, "nothing is deleted before the last confirmation");
  confirm.click();
  assert.equal(erased, 1);
  assert.ok(!dialog.hasAttribute("open"));
});
