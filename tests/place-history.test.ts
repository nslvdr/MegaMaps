import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNavigation, type MapMarker } from "../src/viewer/navigation";
import { lastUpdated, placeChanges, recordEdit } from "../src/viewer/place-history";

const hall = (changes: Partial<MapMarker> = {}): MapMarker => ({
  id: "hall", point: { x: 1, y: 1 }, label: "Hall", description: "Pillars", kind: "room",
  photos: ["p1", "p2"], created: 100, ...changes,
});
const day = 86_400_000;
const noon = new Date(2026, 9, 20, 12).getTime();

test("an edit lists what changed, with both sides of names, types and levels", () => {
  assert.deepEqual(placeChanges(hall(), hall({ label: "Big hall", description: "Pillars, dry", photos: ["p2", "p3"],
    point: { x: 2, y: 1 } })), [
    { field: "name", from: "Hall", to: "Big hall" },
    { field: "description" },
    { field: "photos", added: ["p3"], removed: ["p1"] },
    { field: "point" },
  ]);
  assert.deepEqual(placeChanges(hall(), hall({ photos: ["p2", "p1"] })), [], "reordering photos changes nothing");
  assert.deepEqual(placeChanges(hall(), hall({ kind: "flooded", water: 2 })), [{ field: "kind", from: "room", to: "flooded" }],
    "a new type brings its level without a line of its own");
  assert.deepEqual(placeChanges(hall({ kind: "flooded", water: 1 }), hall({ kind: "flooded", water: 3 })),
    [{ field: "water", from: 1, to: 3 }]);
  assert.deepEqual(placeChanges(hall({ kind: "unstable" }), hall({ kind: "unstable", danger: 2 })), [],
    "a danger place without a level was already severe");
});

test("edits on one day fold into one entry that keeps where each change started", () => {
  const place = hall({ log: [{ id: "note", date: noon - day, text: "Dry" }] });
  recordEdit(place, [{ field: "name", from: "Hall", to: "Big hall" }, { field: "photos", added: ["p3"], removed: [] }], noon);
  const first = place.log!.at(-1)!;
  recordEdit(place, [{ field: "point" }, { field: "name", from: "Big hall", to: "Great hall" },
    { field: "photos", added: ["p4"], removed: ["p3", "p1"] }], noon + 60_000);
  assert.equal(place.log!.length, 2);
  const folded = place.log!.at(-1)!;
  assert.deepEqual(folded.changes, [
    { field: "name", from: "Hall", to: "Great hall" },
    { field: "photos", added: ["p4"], removed: ["p1"] },
    { field: "point" },
  ], "a photo added then removed the same day is no change");
  assert.equal(folded.date, noon + 60_000);
  assert.notEqual(folded.id, first.id);
  assert.deepEqual(place.deletedLog, [first.id], "a copy of the earlier entry from a share can't come back beside it");

  recordEdit(place, [{ field: "name", from: "Great hall", to: "Hall" }, { field: "photos", added: ["p1"], removed: ["p4"] },
    { field: "point" }], noon + 120_000);
  assert.deepEqual(place.log!.at(-1)!.changes, [{ field: "point" }], "a name put back is no change");

  recordEdit(place, [{ field: "description" }], noon + day);
  assert.equal(place.log!.length, 3, "the next day starts a new entry");
  place.log!.push({ id: "visit", date: noon + day });
  recordEdit(place, [{ field: "point" }], noon + day + 1);
  assert.equal(place.log!.length, 5, "an edit after a visit stays apart from the edit before it");
  assert.equal(lastUpdated(place), noon + day + 1);
  assert.equal(lastUpdated(hall()), 100, "with no history, a place was last updated when it was added");
});

test("an edit never folds into someone else's edit from the same day", () => {
  const place = hall({ log: [{ id: "lea", date: noon, changes: [{ field: "point" }], by: "Léa" }] });
  recordEdit(place, [{ field: "description" }], noon + 60_000);
  assert.deepEqual(place.log!.map((entry) => entry.by), ["Léa", undefined]);
  assert.equal(place.deletedLog, undefined);
});

test("a last seen date from an older save becomes a visit, once", () => {
  const load = (marker: object) => normalizeNavigation({ mapId: "m", markers: [{ ...hall(), ...marker }] }).markers[0]!;
  const migrated = load({ lastSeen: 500, seenAt: 600, log: [{ id: "note", date: 400, text: "Dry" }] });
  assert.deepEqual(migrated.log, [{ id: "note", date: 400, text: "Dry" }, { id: "seen-500", date: 500 }]);
  assert.equal("lastSeen" in migrated || "seenAt" in migrated, false);
  assert.deepEqual(load({ lastSeen: 500, log: [{ id: "note", date: 500, text: "Dry" }] }).log!.length, 1,
    "a note that moved last seen already is that visit");
  assert.equal(load({ lastSeen: 100 }).log, undefined, "seen when it was added is no visit");
});
