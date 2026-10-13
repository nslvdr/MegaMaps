import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { lockPageZoom } from "../src/ui/page-zoom";

test("pinches outside the map can't start a page zoom", () => {
  const { document, Event } = parseHTML(`<dialog><p id="text"></p></dialog>`);
  lockPageZoom(document);
  for (const type of ["gesturestart", "gesturechange"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    document.getElementById("text")!.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, type);
  }
});
