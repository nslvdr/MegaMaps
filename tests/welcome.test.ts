import test from "node:test";
import assert from "node:assert/strict";
import { $, click, render } from "./dom";
import Welcome from "../src/ui/Welcome.svelte";
import { setPreference } from "../src/preferences";

function setup() {
  const calls = { imported: 0, example: 0 };
  const { instance } = render(Welcome, {
    hasExample: () => true,
    importMap: () => calls.imported++,
    openExample: () => calls.example++,
  });
  return { welcome: instance, dialog: $<HTMLDialogElement>("welcome"), calls };
}

test("a new device is welcomed once, and can go straight to importing or the example", () => {
  const first = setup();
  setPreference("tour", "new");
  assert.ok(first.welcome.atLaunch(false));
  assert.ok(first.dialog.open);
  click("welcome-example");
  assert.ok(!first.dialog.open);
  assert.equal(first.calls.example, 1);
  assert.ok(!first.welcome.atLaunch(false), "only once");

  const importing = setup();
  setPreference("tour", "new");
  importing.welcome.atLaunch(false);
  click("welcome-import");
  assert.equal(importing.calls.imported, 1);

  const existing = setup();
  setPreference("tour", "new");
  assert.ok(!existing.welcome.atLaunch(true), "a device with maps isn't welcomed");
  assert.ok(!existing.dialog.open);
});
