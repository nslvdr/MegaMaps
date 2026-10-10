import test from "node:test";
import assert from "node:assert/strict";
import { searchMap } from "../src/viewer/map-search";
import type { MapMarker } from "../src/viewer/navigation";
import type { OcrIndex } from "../src/ocr/index";

const places: MapMarker[] = [
  { id: "church", kind: "landmark", label: "Église du Nord", note: "Entrée principale", point: { x: 100, y: 200 }, created: 1 },
  { id: "church-copy", kind: "landmark", label: "Église du Nord", note: "", point: { x: 500, y: 600 }, created: 2 },
  { id: "camp", kind: "note", label: "Camp", note: "Water and supplies", point: { x: 800, y: 900 }, created: 3 },
];
const polygon = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }];
const index: OcrIndex = {
  mapId: "search", version: 1, completedAt: 1,
  lines: [{ text: "Nord", confidence: 99, words: [{ text: "Nord", polygon }] }],
};

test("combined search includes all saved place kinds, notes, and text without collapsing distinct locations", () => {
  const matches = searchMap(index, places, " NÓRD ");
  assert.deepEqual(matches.map(match => match.text), ["Église du Nord", "Église du Nord", "Nord"]);
  assert.deepEqual(matches.map(match => match.marker?.id), ["church", "church-copy", undefined]);
  assert.deepEqual(matches[2]!.polygons, [polygon]);
  assert.equal(searchMap(undefined, places, "GLISE").length, 2, "saved places work without OCR");
  assert.equal(searchMap(undefined, places, "entree")[0]!.marker?.id, "church");
  assert.equal(searchMap(index, places, "suppl")[0]!.marker?.id, "camp");
  assert.deepEqual(searchMap(index, places, "   "), []);
  assert.deepEqual(searchMap(index, places, "unknown"), []);
});

test("combined search never limits matches and uses the latest edited place data", () => {
  const markers = Array.from({ length: 250 }, (_, i) => ({ ...places[0]!, id: String(i), point: { x: i, y: i } }));
  assert.equal(searchMap(index, markers, "nord").length, 251);
  const edited = { ...places[0]!, label: "South church", note: "", point: { x: 999, y: 999 } };
  assert.equal(searchMap(index, [edited], "eglise").length, 0);
  assert.deepEqual(searchMap(undefined, [edited], "south")[0]!.marker?.point, edited.point);
});
