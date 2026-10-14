import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTone, darken, darkMode, type DarkMode } from "../src/viewer/appearance";
import { normalizeNavigation } from "../src/viewer/navigation";

// RGBA buffer: `share` of pixels at `ink`, the rest at `paper` (gray levels).
const image = (paper: number, ink: number, share: number, size = 1000) => {
  const data = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const value = i < size * share ? ink : paper;
    data.set([value, value, value, 255], i * 4);
  }
  return data;
};
// Recolor one pixel the way the viewer bakes tiles.
const recolor = (mode: DarkMode, rgb: number[]) => {
  const pixel = new Uint8ClampedArray([...rgb, 255]);
  darken(pixel, mode.look!);
  return [...pixel.slice(0, 3)];
};
const render = (mode: DarkMode, gray: number) => recolor(mode, [gray, gray, gray])[0]! / 255;

test("a light survey sheet is inverted to a pure black background with bright ink", () => {
  const tone = analyzeTone(image(235, 30, 0.1))!;
  assert.equal(tone.light, true);
  assert.ok(Math.abs(tone.background - 235 / 255) < 0.02);
  assert.ok(Math.abs(tone.ink - 30 / 255) < 0.02);
  const mode = darkMode(tone);
  assert.equal(mode.kind, "inverted");
  assert.match(mode.filter, /^invert\(1\) hue-rotate\(180deg\) contrast/, "previews use the same look");
  assert.equal(render(mode, 235), 0, "paper becomes pure black");
  assert.equal(render(mode, 255), 0);
  assert.ok(render(mode, 30) > 0.85, "ink stays bright");
  assert.ok(render(mode, 30) <= 0.93, "ink is not glaring white");
  const [red, green, blue] = recolor(mode, [200, 30, 30]);
  assert.ok(red! > green! + 60 && red! > blue! + 60, "red ink stays red, not cyan");
});

test("a dark-gray map is deepened to black without inverting", () => {
  const mode = darkMode(analyzeTone(image(45, 220, 0.1)));
  assert.equal(mode.kind, "deepened");
  assert.equal(mode.look!.invert, false);
  assert.equal(render(mode, 45), 0);
  assert.ok(render(mode, 220) > 0.85);
});

test("an already black map with bright ink is left untouched", () => {
  const mode = darkMode(analyzeTone(image(0, 240, 0.1)));
  assert.deepEqual(mode, { filter: "", kind: "already-dark" });
});

test("transparent pixels are ignored and unmeasured maps get a safe default", () => {
  const data = image(235, 30, 0.1);
  data.fill(0, 0, 400 * 4); // transparent block, including all the ink
  const tone = analyzeTone(data)!;
  assert.equal(tone.light, true);
  assert.equal(analyzeTone(new Uint8ClampedArray(16)), undefined);
  const fallback = darkMode(undefined);
  assert.equal(fallback.kind, "inverted");
  assert.equal(render(fallback, 230), 0);
});

test("stored navigation from before layers gains every default", () => {
  const state = normalizeNavigation({
    mapId: "old",
    inverted: false,
    layers: { routes: false, position: false } as never,
    position: { point: { x: 1, y: 2 }, updated: 3 },
    checkpoints: [
      { id: "check", point: { x: 4, y: 5 }, label: "Junction", confirmed: 6 },
    ],
  });
  assert.equal(state.inverted, false, "an explicit choice is kept");
  assert.deepEqual(state.layers, {
    places: true,
    routes: false,
    labels: true,
  });
  assert.equal("position" in state, false, "the removed manual position is dropped");
  assert.equal("checkpoints" in state, false);
  assert.deepEqual(
    state.markers,
    [
      {
        id: "check",
        point: { x: 4, y: 5 },
        label: "Junction",
        description: "",
        kind: "landmark",
        created: 6,
      },
    ],
    "old checkpoints become landmark places",
  );
  assert.deepEqual(state.routes, []);
  assert.equal(normalizeNavigation({ mapId: "new" }).inverted, true);
});
