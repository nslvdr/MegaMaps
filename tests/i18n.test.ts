import test from "node:test";
import assert from "node:assert/strict";
import { errorMessage, pluralIn, translate } from "../src/i18n";

test("French fills the same placeholders into its own sentence", () => {
  assert.equal(translate("fr", "Shared by {name}", { name: "Alex" }), "Partagé par Alex");
  assert.equal(translate("en", "Shared by {name}", { name: "Alex" }), "Shared by Alex");
  assert.equal(translate("fr", "Map {current} of {total} · {step}", { current: 2, total: 3, step: "…" }), "Carte 2 sur 3 · …");
});

test("counts follow each language's plural rule", () => {
  assert.equal(pluralIn("fr", 0, "map"), "0 carte", "French counts zero as singular");
  assert.equal(pluralIn("fr", 2, "place"), "2 lieux");
  assert.equal(pluralIn("fr", 1200, "route"), "1 200 itinéraires");
  assert.equal(pluralIn("en", 0, "map"), "0 maps");
  assert.equal(pluralIn("en", 1, "place"), "1 place");
  assert.equal(pluralIn("en", 2, "match"), "2 matches");
});

test("a browser's unreadable-file and full-storage errors read as advice, others as they are", () => {
  const error = (name: string, message: string) => Object.assign(new Error(message), { name });
  assert.match(errorMessage(error("NotReadableError", "The requested file could not be read")), /cloud folder/);
  assert.match(errorMessage(new DOMException("The quota has been exceeded.", "QuotaExceededError")), /Not enough device storage/);
  assert.equal(errorMessage(new Error("Choose a JPEG, PNG, or WebP image.")), "Choose a JPEG, PNG, or WebP image.");
  assert.equal(errorMessage("offline"), "offline");
});
