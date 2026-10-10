import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initLibraryKeys } from "../src/ui/library-keys";

test("library keys step between maps, keep the column, and rename or delete the focused map", () => {
  const card = (id: string) =>
    `<article class="map-card" data-map="${id}"><button class="map-open">${id}</button><button class="map-more">More</button></article>`;
  const { window, document } = parseHTML(
    `<html><body><div id="grid">${["a", "b", "c"].map(card).join("")}</div></body></html>`,
  );
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    window: { value: window, configurable: true },
  });
  const grid = document.getElementById("grid")!;
  let focused: Element | undefined;
  window.HTMLElement.prototype.focus = function (this: HTMLElement) { focused = this; };
  const calls: string[] = [];
  initLibraryKeys(grid, {
    rename: (id) => calls.push(`rename ${id}`),
    remove: (id) => calls.push(`remove ${id}`),
  });
  const button = (id: string, part = "open") =>
    document.querySelector(`[data-map="${id}"] .map-${part}`)!;
  const press = (target: Element, key: string, modifiers: Partial<KeyboardEvent> = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperties(event, Object.fromEntries(
      Object.entries({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers })
        .map(([name, value]) => [name, { value }]),
    ));
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  assert.equal(press(button("a"), "ArrowDown"), true);
  assert.ok(focused === button("b"), "Down moves to the next map");
  press(button("b"), "End");
  assert.ok(focused === button("c"), "End jumps to the last map");
  press(button("c"), "Home");
  assert.ok(focused === button("a"), "Home jumps to the first map");
  press(button("c", "more"), "ArrowUp");
  assert.ok(focused === button("b", "more"), "options stay in their column");
  focused = undefined;
  assert.equal(press(button("c"), "ArrowDown"), false, "the last map stays put");
  assert.equal(press(button("a"), "ArrowDown", { shiftKey: true }), false);
  assert.equal(press(button("a"), "ArrowDown", { metaKey: true }), false);
  assert.equal(focused, undefined);

  assert.equal(press(button("b"), "F2"), true);
  assert.equal(press(button("b"), "Delete"), true);
  assert.equal(press(button("c"), "Backspace", { metaKey: true }), true);
  assert.equal(press(button("a"), "Delete", { shiftKey: true }), false);
  assert.equal(press(button("a", "more"), "Delete"), false, "only the map itself takes shortcuts");
  assert.deepEqual(calls, ["rename b", "remove b", "remove c"]);
});

test("typing a map's first letters jumps to it", () => {
  const names = ["Harbour", "Old town", "Hills", "Hospital"];
  const { window, document } = parseHTML(
    `<html><body><div id="grid">${names.map((name) =>
      `<article class="map-card" data-map="${name}"><button class="map-open"><h3>${name}</h3></button><button class="map-more">More</button></article>`).join("")}</div></body></html>`,
  );
  Object.defineProperties(globalThis, {
    document: { value: document, configurable: true },
    window: { value: window, configurable: true },
  });
  let focused: Element | undefined;
  window.HTMLElement.prototype.focus = function (this: HTMLElement) { focused = this; };
  initLibraryKeys(document.getElementById("grid")!, { rename() {}, remove() {} });
  const button = (name: string, part = "open") =>
    document.querySelector(`[data-map="${name}"] .map-${part}`)!;
  const press = (target: Element, key: string, modifiers: Partial<KeyboardEvent> = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperties(event, Object.fromEntries(
      Object.entries({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers })
        .map(([name, value]) => [name, { value }]),
    ));
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    assert.equal(press(button("Harbour"), "o"), true);
    assert.ok(focused === button("Old town"), "a letter jumps to the next map starting with it");
    now += 1000;
    press(button("Old town"), "h");
    assert.ok(focused === button("Hills"), "the search starts after the focused map");
    now += 100;
    press(button("Hills"), "h");
    assert.ok(focused === button("Hospital"), "repeating a letter cycles");
    now += 100;
    press(button("Hospital"), "h");
    assert.ok(focused === button("Harbour"), "and wraps around");
    now += 1000;
    press(button("Harbour"), "H", { shiftKey: true });
    now += 100;
    press(button("Hills"), "o");
    assert.ok(focused === button("Hospital"), "quick letters spell a longer prefix");
    now += 1000;
    press(button("Harbour", "more"), "o");
    assert.ok(focused === button("Old town", "more"), "options stay in their column");
    focused = undefined;
    now += 1000;
    assert.equal(press(button("Harbour"), "z"), false, "no match leaves focus alone");
    assert.equal(press(button("Harbour"), " "), false, "Space still presses the button");
    assert.equal(press(button("Harbour"), "o", { metaKey: true }), false);
    assert.equal(focused, undefined);
  } finally {
    Date.now = realNow;
  }
});
