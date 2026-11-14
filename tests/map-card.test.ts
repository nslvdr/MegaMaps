import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { $, click, render } from "./dom";
import { app } from "../src/ui/app-state.svelte";
import MapCard from "../src/ui/MapCard.svelte";
import type { MapRecord } from "../src/types";

test("a map card hands the app a map that text scans and storage can clone", () => {
  const record: MapRecord = {
    id: "card", name: "Quarry.jpg", width: 4000, height: 3000, bytes: 1, backend: "indexeddb",
    levels: [{ width: 4000, height: 3000, scale: 1, cols: 16, rows: 12 }], created: 1, status: "ready",
    shrunkFrom: { width: 8000, height: 6000 },
  };
  // As in the library: a map read from app state, a Svelte proxy that structured clone rejects.
  app.maps = [record];
  const shown = app.maps[0]!;
  assert.throws(() => structuredClone(shown), { name: "DataCloneError" });
  const received: MapRecord[] = [];
  render(MapCard, { map: shown, saving: async () => {}, open: (map) => received.push(map), more: (map) => received.push(map) });
  click($("[data-map] button"));
  click($("[data-map] > button:last-child"));
  assert.equal(received.length, 2);
  // What the text scan posts to its workers, and what deleting writes to IndexedDB.
  for (const map of received) {
    assert.deepEqual(structuredClone({ map, section: 0 }), { map: record, section: 0 });
    assert.deepEqual(structuredClone({ ...map, status: "deleting" }), { ...record, status: "deleting" });
  }
});
