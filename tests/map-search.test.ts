import test from "node:test";
import assert from "node:assert/strict";
import { crossingTerms, searchMap } from "../src/viewer/map-search";
import type { MapMarker } from "../src/viewer/navigation";
import type { OcrIndex } from "../src/ocr/index";

const places: MapMarker[] = [
  { id: "church", kind: "landmark", label: "Église du Nord", description: "Entrée principale", point: { x: 100, y: 200 }, created: 1 },
  { id: "church-copy", kind: "landmark", label: "Église du Nord", description: "", point: { x: 500, y: 600 }, created: 2 },
  { id: "camp", kind: "landmark", label: "Camp", description: "Water and supplies", point: { x: 800, y: 900 }, created: 3 },
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
  const edited = { ...places[0]!, label: "South church", description: "", point: { x: 999, y: 999 } };
  assert.equal(searchMap(index, [edited], "eglise").length, 0);
  assert.deepEqual(searchMap(undefined, [edited], "south")[0]!.marker?.point, edited.point);
});

test("two alley names find where their labels meet", () => {
  assert.deepEqual(crossingTerms("Allée 25 ; Allée 55"), ["allee 25", "allee 55"]);
  assert.deepEqual(crossingTerms("25;55"), ["25", "55"]);
  assert.equal(crossingTerms("Allée 25 et 55"), undefined, "only a semicolon splits a query");
  assert.equal(crossingTerms("Allée 25;"), undefined, "half-typed queries stay plain searches");
  assert.equal(crossingTerms("25;55;75"), undefined);
  const word = (text: string, x: number, y: number) =>
    ({ text, confidence: 99, words: text.split(" ").map((part, i) => ({ text: part,
      polygon: [{ x: x + i * 60, y }, { x: x + i * 60 + 50, y }, { x: x + i * 60 + 50, y: y + 20 }, { x: x + i * 60, y: y + 20 }] })) });
  const alleys: OcrIndex = { mapId: "alleys", version: 1, completedAt: 1, lines: [
    word("Allée 25", 0, 0), word("Allée 125", 0, 40), word("Allée 55", 2000, 0),
    word("Allée 25", 1000, 1000), word("Allée 55", 1000, 1050),
  ] };
  const [crossing] = searchMap(alleys, [], "Allée 25; Allée 55");
  assert.deepEqual(crossing!.crossing, { x: 1055, y: 1035 }, "the closest pair of labels, ignoring Allée 125");
  assert.equal(crossing!.text, "Allée 25 × Allée 55");
  assert.equal(crossing!.polygons.length, 4);
  assert.deepEqual(searchMap(alleys, [], "Allée 125; Allée 55"), [], "labels far apart do not cross");
  assert.equal(searchMap(alleys, [], "25").length, 3, "a single name still finds every partial match");
});
