import test from "node:test";
import assert from "node:assert/strict";
import { lastUsed, nextName, seenAgo } from "../src/ui/format";

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

test("places say how long ago they were seen, in the unit that reads best", () => {
  const now = new Date(2026, 9, 12, 9, 30).getTime();
  const at = (month: number, date: number, year = 2026) => new Date(year, month, date, 12).getTime();
  assert.equal(seenAgo(at(9, 12), now), "Seen today");
  assert.equal(seenAgo(at(9, 11), now), "Seen yesterday");
  assert.equal(seenAgo(at(9, 2), now), "Seen 10 days ago");
  assert.equal(seenAgo(at(8, 21), now), "Seen 3 weeks ago");
  assert.equal(seenAgo(at(7, 12, 2025), now), "Seen 14 months ago");
  assert.equal(seenAgo(at(9, 12, 2024), now), "Seen 2 years ago");
});
