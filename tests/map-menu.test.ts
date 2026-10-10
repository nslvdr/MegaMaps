import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initMapMenu } from "../src/ui/map-menu";

test("opening library actions leaves them unfocused; clicking acts and Escape restores focus", (t) => {
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

  menu.toggle(anchor, "My map", items);
  const escape = new window.Event("keydown");
  Object.defineProperty(escape, "key", { value: "Escape" });
  document.dispatchEvent(escape);
  assert.ok(!document.querySelector(".map-menu"), "menu closed");
  assert.equal(focus.mock.callCount(), 1);
  assert.equal(focus.mock.calls[0]!.this, anchor);
});

test("arrow keys walk the library menu from its button and wrap around", () => {
  const { window, document } = parseHTML('<html><body><button class="map-more">Actions</button></body></html>');
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    window: { value: window, configurable: true },
  });
  let focused: Element | undefined;
  window.HTMLElement.prototype.focus = function (this: HTMLElement) { focused = this; };
  const anchor = document.querySelector<HTMLButtonElement>("button")!;
  const menu = initMapMenu();
  menu.toggle(anchor, "My map", ["Share", "Rename", "Delete"].map((label) => ({ label, icon: "", action() {} })));
  const press = (target: Element, key: string) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const items = [...document.querySelectorAll(".popover-item")];
  assert.equal(press(anchor, "ArrowDown"), true);
  assert.ok(focused === items[0], "Down from the button enters at the top");
  press(items[0]!, "ArrowUp");
  assert.ok(focused === items[2], "Up from the top wraps to the bottom");
  press(items[2]!, "ArrowDown");
  assert.ok(focused === items[0], "Down from the bottom wraps to the top");
  press(items[0]!, "End");
  assert.ok(focused === items[2]);
  menu.close();
  focused = undefined;
  assert.equal(press(anchor, "ArrowDown"), false, "a closed menu leaves the arrows alone");
  assert.equal(focused, undefined);
});
