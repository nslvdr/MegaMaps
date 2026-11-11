import test from "node:test";
import assert from "node:assert/strict";
import { recolour, streetFade } from "../src/viewer/street-tiles";

/** One pixel per colour, recoloured in that style. */
const recoloured = (style: Parameters<typeof recolour>[1], ...pixels: [number, number, number][]) => {
  const rgba = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  recolour(rgba, style);
  return pixels.map((_, i) => [...rgba.slice(i * 4, i * 4 + 3)]);
};
const osmBackground: [number, number, number] = [242, 239, 233], label: [number, number, number] = [0, 0, 0];

test("coloured streets drop OSM's light fills and draw what's dark in one colour", () => {
  assert.deepEqual(recoloured({ dark: false, color: "violet" }, osmBackground, label),
    [[255, 255, 255], [110, 60, 220]], "white leaves a light map as it is under multiply");
  assert.deepEqual(recoloured({ dark: true, color: "violet" }, osmBackground, label),
    [[0, 0, 0], [160, 130, 255]], "black leaves a dark map as it is under screen");
});

test("OSM's own colours are kept as they are, or inverted for a dark map", () => {
  assert.deepEqual(recoloured({ dark: false, color: "osm" }, osmBackground), [osmBackground]);
  const [dark] = recoloured({ dark: true, color: "osm" }, osmBackground);
  assert.ok(dark!.every((value) => value < 30), "the light background turns dark");
});

test("streets keep their strength zoomed out and fade zoomed in, never quite away", () => {
  assert.equal(streetFade(5), 1);
  assert.equal(streetFade(0.8), 1, "full at street level");
  assert.equal(streetFade(0.01), 0.25, "a quarter zoomed right in");
  const steps = [0.8, 0.4, 0.2, 0.1].map(streetFade);
  assert.ok(steps.every((value, i) => i === 0 || value < steps[i - 1]!), "fading as you zoom in");
});
