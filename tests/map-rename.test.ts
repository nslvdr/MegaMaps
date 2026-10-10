import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initMapRename, mapRenameMarkup } from "../src/ui/map-rename";

function setup(save: (id: string, name: string) => Promise<void>) {
  const { window, document } = parseHTML(mapRenameMarkup);
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  // Linkedom omits native dialog and text-selection behavior.
  Object.defineProperties(dialog, {
    open: { get: () => dialog.hasAttribute("open") },
    showModal: { value: () => dialog.setAttribute("open", "") },
    close: { value: () => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new window.Event("close"));
    } },
  });
  Object.defineProperty(input, "select", { value: () => {}, configurable: true });
  return {
    dialog, input,
    error: dialog.querySelector<HTMLElement>(".dialog-error")!,
    open: initMapRename(dialog, save),
    cancel: () => dialog.querySelector("#rename-map-cancel")!.dispatchEvent(new window.Event("click")),
    escape: () => dialog.dispatchEvent(new window.Event("cancel", { cancelable: true })),
    submit: () => dialog.querySelector("form")!.dispatchEvent(new window.Event("submit", { cancelable: true })),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("opening rename leaves the name unselected and gives native focus to the heading", (t) => {
  const ui = setup(async () => {});
  const focus = t.mock.method(ui.input, "focus");
  const select = t.mock.method(ui.input, "select");
  ui.open({ id: "map", name: "My map" });
  assert.equal(ui.input.value, "My map");
  assert.equal(focus.mock.callCount(), 0);
  assert.equal(select.mock.callCount(), 0);
  assert.equal(ui.dialog.querySelector("[autofocus]"), ui.dialog.querySelector("h2"));
  assert.equal(ui.dialog.querySelector("h2")!.tabIndex, -1);
  // The library hides the file extension, so Rename does too.
  ui.dialog.close();
  ui.open({ id: "map", name: "Cave survey.png" });
  assert.equal(ui.input.value, "Cave survey");
});

test("rename dialog cancels without saving, rejects blank names and waits for one durable save", async () => {
  const calls: [string, string][] = [];
  let finish = () => {};
  const ui = setup((id, name) => {
    calls.push([id, name]);
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  ui.open({ id: "first", name: "First map" });
  assert.equal(ui.input.value, "First map");
  ui.input.value = "Discard this";
  ui.cancel();
  assert.equal(ui.dialog.open, false);
  assert.deepEqual(calls, []);

  ui.open({ id: "second", name: "Second map" });
  ui.input.value = "   ";
  ui.submit();
  assert.equal(ui.error.hidden, false);
  assert.deepEqual(calls, []);
  ui.input.value = "  Survey <2026>  ";
  ui.submit();
  ui.submit();
  assert.deepEqual(calls, [["second", "Survey <2026>"]]);
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.input.disabled, true);
  assert.equal(ui.escape(), false, "Escape is blocked during persistence");
  finish();
  await settle();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.input.disabled, false);
});

test("failed rename keeps the edited name and allows retry", async () => {
  let attempts = 0;
  const ui = setup(async () => {
    if (++attempts === 1) throw new Error("Storage unavailable");
  });
  ui.open({ id: "map", name: "Old name" });
  ui.input.value = "New name";
  ui.submit();
  await settle();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.input.value, "New name");
  assert.equal(ui.error.textContent, "Storage unavailable");
  assert.equal(ui.error.hidden, false);
  assert.equal(ui.input.disabled, false);
  ui.submit();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(ui.dialog.open, false);
});
