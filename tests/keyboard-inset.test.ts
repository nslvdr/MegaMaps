import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initTapAway, isTextEntry, keyboardInset } from "../src/ui/keyboard-inset";

test("keyboard inset is the layout height hidden below the visible area", () => {
  assert.equal(keyboardInset(800, { height: 800, offsetTop: 0 }), 0);
  assert.equal(keyboardInset(800, { height: 460, offsetTop: 0 }), 340);
  // The browser may pan the visible area up to reveal the field.
  assert.equal(keyboardInset(800, { height: 460, offsetTop: 120 }), 220);
  assert.equal(keyboardInset(800, { height: 460, offsetTop: 340 }), 0);
  assert.equal(keyboardInset(800, { height: 820, offsetTop: 0 }), 0);
});

test("only fields that bring up a keyboard count as text entry", () => {
  const { document } = parseHTML(
    `<input id="search" type="search"><input id="plain"><input id="switch" type="checkbox"><input id="slider" type="range"><textarea id="note"></textarea><button id="save"></button>`,
  );
  const entry = (id: string) => isTextEntry(document.getElementById(id));
  assert.equal(entry("search"), true);
  assert.equal(entry("plain"), true);
  assert.equal(entry("note"), true);
  assert.equal(entry("switch"), false);
  assert.equal(entry("slider"), false);
  assert.equal(entry("save"), false);
  assert.equal(isTextEntry(null), false);
});

test("a tap on empty space in a form puts the keyboard away; controls, drags and the page don't", (t) => {
  const { window, document } = parseHTML(
    `<html><body><dialog><p id="blank">Notes</p><label id="caption">Name<input id="name"></label><button id="save"></button></dialog><p id="outside"></p></body></html>`,
  );
  const name = document.getElementById("name")!;
  Object.defineProperty(document, "activeElement", { get: () => name });
  const blur = t.mock.method(name, "blur");
  initTapAway("dialog", document as unknown as Document);
  const pointer = (type: string, id: string, x: number) => {
    const event = new window.Event(type, { bubbles: true });
    Object.defineProperties(event, { clientX: { value: x }, clientY: { value: 0 } });
    document.getElementById(id)!.dispatchEvent(event);
  };
  const tap = (id: string, drag = 0) => {
    pointer("pointerdown", id, 0);
    pointer("pointerup", id, drag);
  };
  for (const id of ["name", "caption", "save", "outside"]) tap(id);
  tap("blank", 40);
  assert.equal(blur.mock.callCount(), 0, "the field, its label, a button, outside the form or a drag");
  tap("blank");
  assert.equal(blur.mock.callCount(), 1, "a tap on empty space");
});
