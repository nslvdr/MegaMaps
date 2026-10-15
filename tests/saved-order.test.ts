import test from "node:test";
import assert from "node:assert/strict";
import { orderPlaces } from "../src/ui/saved-order";
import type { MapMarker } from "../src/viewer/navigation";

const place = (label: string, kind: MapMarker["kind"], created: number, lastSeen?: number): MapMarker => ({
  id: label, point: { x: 0, y: 0 }, label, description: "", kind, created, ...(lastSeen ? { lastSeen } : {}),
});

test("places order by date, name, type or last visit", () => {
  const places = [
    place("entrance 10", "entrance", 1),
    place("Pit", "unstable", 3),
    place("Entrance 2", "entrance", 2, 9),
    place("Écho", "landmark", 4),
  ];
  const labels = (order: Parameters<typeof orderPlaces>[1]) => orderPlaces(places, order).map((p) => p.label);
  assert.deepEqual(labels("newest"), ["Écho", "Pit", "Entrance 2", "entrance 10"]);
  assert.deepEqual(labels("oldest"), ["entrance 10", "Entrance 2", "Pit", "Écho"]);
  assert.deepEqual(labels("name"), ["Écho", "Entrance 2", "entrance 10", "Pit"], "ignores case and accents, counts numbers");
  assert.deepEqual(labels("type"), ["Écho", "Entrance 2", "entrance 10", "Pit"], "the picker's kind order, then by name");
  assert.deepEqual(labels("seen"), ["Entrance 2", "Écho", "Pit", "entrance 10"], "never seen counts from when it was added");
  assert.equal(places[0]!.label, "entrance 10", "the saved order is left alone");
});
