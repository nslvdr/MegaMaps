import test from "node:test";
import assert from "node:assert/strict";
import { summarizeActivity, WEEKS } from "../src/ui/activity";

const HOUR = 3_600_000;
/** A trip that started at `start` and lasted `hours`. */
const trip = (start: Date, hours: number) => ({ id: String(+start), points: [{ x: 0, y: 0, time: +start }], ended: +start + hours * HOUR });
const map = (name: string, trips: ReturnType<typeof trip>[], places = 0) => ({ name, navigation: {
  trips, routes: [{ photos: ["r"] }],
  markers: Array.from({ length: places }, () => ({ photos: ["a", "b"] })),
} as never });

test("the activity card adds up trips, time, places and photos, and finds the records", () => {
  const now = new Date(2026, 10, 9, 12); // A Monday.
  const a = summarizeActivity([
    map("Val Moulin.jpg", [trip(new Date(2026, 10, 8, 10), 3), trip(new Date(2026, 10, 1, 10), 1)], 2),
    map("Capucins", [trip(new Date(2026, 9, 25, 9), 4.5)], 1),
  ], +now);
  assert.equal(a.trips, 3);
  assert.equal(a.minutes, (3 + 1 + 4.5) * 60);
  assert.equal(a.places, 3);
  assert.equal(a.photos, 3 * 2 + 2, "place and route photos");
  assert.deepEqual(a.longest, { minutes: 270, started: +new Date(2026, 9, 25, 9) });
  assert.deepEqual(a.favourite, { name: "Val Moulin.jpg", trips: 2 });
  assert.equal(a.streak, 3, "three weeks in a row up to last week still runs");
  assert.equal(a.best, 3);
  assert.equal(a.daysOut, 3);
  assert.equal(a.days.length, WEEKS * 7);
  assert.equal(a.days[a.today - 1], 180, "yesterday's trip sits the day before today");
});

test("a gap of a week ends the streak, but the best run is kept", () => {
  const now = new Date(2026, 10, 9, 12);
  const a = summarizeActivity([map("Quarry", [
    trip(new Date(2026, 9, 4), 1), trip(new Date(2026, 9, 11), 1),
    trip(new Date(2026, 10, 8), 1),
  ])], +now);
  assert.equal(a.best, 2);
  assert.equal(a.streak, 1);
  assert.equal(summarizeActivity([map("Quarry", [trip(new Date(2026, 9, 4), 1)])], +now).streak, 0);
});

test("trips older than a year count in the totals but not the graph", () => {
  const a = summarizeActivity([map("Quarry", [trip(new Date(2024, 0, 6), 2)])], +new Date(2026, 10, 9));
  assert.equal(a.trips, 1);
  assert.equal(a.daysOut, 0);
});
