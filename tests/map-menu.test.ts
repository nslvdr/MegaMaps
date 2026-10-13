import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initMapMenu } from "../src/ui/map-menu";

test("opening library actions leaves them unfocused and clicking one acts", (t) => {
  const { window, document } = parseHTML('<html><body><button class="map-more">Actions</button></body></html>');
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    window: { value: window, configurable: true },
  });
  const focus = t.mock.method(window.HTMLElement.prototype, "focus");
  const anchor = document.querySelector<HTMLButtonElement>("button")!;
  const menu = initMapMenu();
  let edited = false;
  const items = [{ label: "Rename", icon: "", action: () => { edited = true; } }];

  menu.toggle(anchor, "My map", items);
  assert.equal(focus.mock.callCount(), 0);
  assert.equal(anchor.getAttribute("aria-expanded"), "true");
  document.querySelector(".popover-item")!.dispatchEvent(new window.Event("click"));
  assert.equal(edited, true);
  assert.ok(!document.querySelector(".map-menu"), "menu closed");
  assert.equal(focus.mock.callCount(), 0);
});
