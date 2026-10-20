import test from "node:test";
import assert from "node:assert/strict";
import { changeLine, dangerBadge, lastUsed, nextName, updatedAgo, waterBadge } from "../src/ui/format";
import type { PlaceChange } from "../src/viewer/navigation";

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

test("places say how long ago they were updated, in the unit that reads best", () => {
  const now = new Date(2026, 9, 12, 9, 30).getTime();
  const at = (month: number, date: number, year = 2026) => new Date(year, month, date, 12).getTime();
  assert.equal(updatedAgo(at(9, 12), now), "Updated today");
  assert.equal(updatedAgo(at(9, 11), now), "Updated yesterday");
  assert.equal(updatedAgo(at(9, 2), now), "Updated 10 days ago");
  assert.equal(updatedAgo(at(8, 21), now), "Updated 3 weeks ago");
  assert.equal(updatedAgo(at(7, 12, 2025), now), "Updated 14 months ago");
  assert.equal(updatedAgo(at(9, 12, 2024), now), "Updated 2 years ago");
});

test("an edit shows each change as its field, then what it became", () => {
  assert.deepEqual([
    { field: "name", from: "Hall", to: "Big hall" },
    { field: "kind", from: "room", to: "flooded" },
    { field: "description" },
    { field: "photos", added: ["p1", "p2"], removed: ["p0"] },
    { field: "point" },
  ].map((change) => changeLine(change as PlaceChange)), [
    { field: "Name", from: "Hall", to: "Big hall" },
    { field: "Type", from: "Room", to: "Flooded" },
    { field: "Description", detail: "edited" },
    { field: "Photos", detail: "2 added, 1 removed" },
    { field: "Position", detail: "moved" },
  ]);
  const water = (from?: 1 | 2 | 3, to?: 1 | 2 | 3) => changeLine({ field: "water", from, to });
  assert.deepEqual(water(1, 3), { field: "Water level", from: "Ankle", to: "Waist+" });
  assert.deepEqual(water(undefined, 3), { field: "Water level", from: undefined, to: "Waist+" },
    "a first level has nothing to come from");
  assert.deepEqual(water(2), { field: "Water level", detail: "removed" });
  assert.deepEqual(changeLine({ field: "danger", from: 1, to: 2 }), { field: "Danger level", from: "Moderate", to: "Severe" });
  assert.deepEqual([waterBadge(2).label, waterBadge(2).step, waterBadge(2).steps], ["Knee", 2, 3], "a level fills its share of the meter");
  assert.deepEqual([dangerBadge(1).label, dangerBadge(1).steps], ["Moderate", 2]);
});
