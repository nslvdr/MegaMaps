import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { isTextEntry, keyboardInset } from "../src/ui/keyboard-inset";

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
