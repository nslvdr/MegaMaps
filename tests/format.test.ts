import test from "node:test";
import assert from "node:assert/strict";
import { lastUsed, nextName } from "../src/ui/format";

test("cards say when a map was last opened, or added if never opened", () => {
  const now = new Date(2026, 9, 12, 9, 30).getTime();
  const at = (month: number, date: number, hour = 12, year = 2026) => new Date(year, month, date, hour).getTime();
  assert.equal(lastUsed({ created: at(9, 1), opened: at(9, 12, 8) }, now), "Opened today");
  assert.equal(lastUsed({ created: at(9, 11, 23) }, now), "Added yesterday");
  assert.equal(lastUsed({ created: at(9, 1), opened: at(9, 9) }, now), "Opened 3 days ago");
  const older = lastUsed({ created: at(8, 4) }, now);
  assert.match(older, /^Added /);
  assert.doesNotMatch(older, /2026/);
  assert.match(lastUsed({ created: at(2, 4, 12, 2025) }, now), /2025/);
});

test("default names count per kind and skip past numbers still in use", () => {
  assert.equal(nextName("Entrance", ["Landmark 1"]), "Entrance 1");
  assert.equal(nextName("Landmark", ["Landmark 1", "Landmark 3"]), "Landmark 4", "a gap left by a deletion is not reused");
  assert.equal(nextName("Route", ["Route 2", "Routes 9", "Route 1b", "Old route"]), "Route 3");
});
