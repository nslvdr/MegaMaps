import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initWelcome, welcomeMarkup } from "../src/ui/welcome";
import { setPreference } from "../src/preferences";

function setup() {
  const { document } = parseHTML(`<html><body>${welcomeMarkup}</body></html>`);
  // Linkedom omits native dialog behavior.
  const dialog = document.querySelector<HTMLDialogElement>("#welcome")!;
  Object.defineProperties(dialog, {
    open: { get: () => dialog.hasAttribute("open") },
    showModal: { value: () => dialog.setAttribute("open", "") },
    close: { value: () => dialog.removeAttribute("open") },
  });
  const calls = { imported: 0, example: 0 };
  const welcome = initWelcome(dialog, {
    hasExample: () => true,
    importMap: () => calls.imported++,
    openExample: () => calls.example++,
  });
  const click = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!.click();
  return { welcome, dialog, calls, click };
}

test("a new device is welcomed once, and can go straight to importing or the example", () => {
  const first = setup();
  setPreference("tour", "new");
  assert.ok(first.welcome.atLaunch(false));
  assert.ok(first.dialog.open);
  first.click("welcome-example");
  assert.ok(!first.dialog.open);
  assert.equal(first.calls.example, 1);
  assert.ok(!first.welcome.atLaunch(false), "only once");

  const importing = setup();
  setPreference("tour", "new");
  importing.welcome.atLaunch(false);
  importing.click("welcome-import");
  assert.equal(importing.calls.imported, 1);

  const existing = setup();
  setPreference("tour", "new");
  assert.ok(!existing.welcome.atLaunch(true), "a device with maps isn't welcomed");
  assert.ok(!existing.dialog.open);
});
