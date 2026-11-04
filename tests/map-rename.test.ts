import test from "node:test";
import assert from "node:assert/strict";
import { $, cancel, click, render, settle, submit, type } from "./dom";
import MapRename from "../src/ui/MapRename.svelte";

function setup(save: (id: string, name: string) => Promise<void>) {
  const { instance } = render(MapRename, { save });
  return {
    open: instance.open,
    dialog: $<HTMLDialogElement>("rename-map-dialog"),
    input: $<HTMLInputElement>("rename-map-name"),
    error: $("rename-map-error"),
    submit: () => submit($("rename-map-dialog").querySelector("form")!),
  };
}

test("opening rename brings up the keyboard with the name selected to type over", (t) => {
  const ui = setup(async () => {});
  const focus = t.mock.method(ui.input, "focus");
  const select = t.mock.method(ui.input, "select");
  ui.open({ id: "map", name: "My map" });
  assert.equal(ui.input.value, "My map");
  assert.equal(focus.mock.callCount(), 1);
  assert.equal(select.mock.callCount(), 1);
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
  type(ui.input, "Discard this");
  assert.equal(cancel(ui.dialog), false, "a close request keeps the typed name");
  assert.equal(ui.dialog.open, true);
  click("rename-map-cancel");
  assert.equal(ui.dialog.open, false);
  assert.deepEqual(calls, []);

  ui.open({ id: "second", name: "Second map" });
  type(ui.input, "   ");
  ui.submit();
  assert.equal(ui.error.hidden, false);
  assert.deepEqual(calls, []);
  type(ui.input, "  Survey <2026>  ");
  ui.submit();
  ui.submit();
  assert.deepEqual(calls, [["second", "Survey <2026>"]]);
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.input.disabled, true);
  assert.equal($<HTMLButtonElement>("rename-map-cancel").disabled, true, "the header cross is blocked while saving");
  assert.equal(cancel(ui.dialog), false, "close requests are blocked during persistence");
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
  type(ui.input, "New name");
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
