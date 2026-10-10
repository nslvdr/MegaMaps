import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Viewer } from "../src/viewer/viewer";
import { screenToWorld, worldToScreen, type Camera, type Point } from "../src/viewer/camera";
import { defaultNavigation } from "../src/viewer/navigation";
import { payloadStore } from "../src/storage/payloads";
import { installPlatform, nativeStats } from "./node-platform";
import { tileKey, type MapRecord } from "../src/types";

test("renderer restores a rotated view, inverts only the map, keeps margins dark, and blocks locked controls", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-viewer-renderer-"));
  await installPlatform(root);
  const { window, document } = parseHTML(
    "<html><body><canvas></canvas><svg></svg></body></html>",
  );
  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: window,
    configurable: true,
  });
  window.matchMedia = () => ({ matches: false }) as MediaQueryList;
  window.devicePixelRatio = 1;
  let resize = () => {};
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    },
  });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => frames.delete(id),
  });
  const step = (time = performance.now()) => {
    const batch = [...frames];
    frames.clear();
    for (const [, callback] of batch) callback(time);
  };
  const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
  const backing = createCanvas(390, 844);
  let viewport = { width: 390, height: 844 };
  Object.defineProperties(canvas, {
    clientWidth: { get: () => viewport.width },
    clientHeight: { get: () => viewport.height },
    width: {
      get: () => backing.width,
      set: (value: number) => {
        backing.width = value;
      },
    },
    height: {
      get: () => backing.height,
      set: (value: number) => {
        backing.height = value;
      },
    },
    getContext: { value: () => backing.getContext("2d") },
  });
  const tile = createCanvas(512, 512);
  tile.getContext("2d").fillStyle = "#ffffff";
  tile.getContext("2d").fillRect(0, 0, 512, 512);
  const map: MapRecord = {
    id: "renderer",
    name: "cave.png",
    width: 512,
    height: 512,
    backend: "indexeddb",
    bytes: 1,
    status: "ready",
    created: 0,
    levels: [{ width: 512, height: 512, scale: 1, cols: 1, rows: 1 }],
  };
  await payloadStore("indexeddb").put(
    map.id,
    tileKey(0, 0, 0),
    new Blob([new Uint8Array(await tile.encode("png"))]),
  );
  const state = defaultNavigation(map.id);
  state.inverted = true;
  state.dimming = 0.4;
  state.view = {
    center: { x: 256, y: 256 },
    scale: 0.5,
    rotation: Math.PI / 2,
  };
  state.markers.push({
    id: "entrance",
    label: "<Entrance>",
    kind: "entrance",
    note: "",
    point: { x: 256, y: 256 },
    created: 0,
  });
  const overlay = document.querySelector<SVGSVGElement>("svg")!;
  const errors: string[] = [],
    drops: boolean[] = [],
    opened: string[] = [];
  const viewer = new Viewer(
    canvas,
    map,
    () => {},
    (error) => errors.push(error),
    {
      navigation: state,
      overlay,
      onView() {},
      onTap() {},
      onMarker: (marker) => opened.push(marker.id),
      onDrop: (moved) => drops.push(moved),
    },
  );
  try {
    // Before the overview is measured, assume a light sheet: invert + stretch.
    assert.equal(
      canvas.style.filter,
      "invert(1) hue-rotate(180deg) contrast(1.471) brightness(0.92) brightness(0.4)",
    );
    assert.equal(overlay.style.filter, "");
    step();
    // The margin is painted white so the inverting filter turns it pure black.
    assert.deepEqual(
      [...backing.getContext("2d").getImageData(0, 0, 1, 1).data],
      [255, 255, 255, 255],
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(viewer.diagnostics().darkMode, "inverted");
    assert.match(canvas.style.filter, /^invert\(1\) hue-rotate\(180deg\) contrast\([\d.]+\) brightness\([\d.]+\) brightness\(0\.4\)$/);
    assert.equal(overlay.querySelector("text")!.textContent, "<Entrance>");
    assert.equal(
      overlay.querySelector("text")!.parentElement!.classList.contains("overlay-label"),
      true,
    );
    assert.match(
      overlay.querySelector('[data-layer="places"] > g')!.getAttribute("transform")!,
      /translate\(195(\.0)?,422(\.0)?\)/,
    );
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    viewer.rotateTo(0); // Default map rotation lock also blocks explicit controls.
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    viewer.fit();
    step(performance.now() + 100);
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    step(performance.now() + 300);
    viewer.fit(); // Fitting an already-fitted rotated map must keep its angle mid-animation.
    step(performance.now() + 100);
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    step(performance.now() + 300);
    // At fit zoom, pan a corner to the center and retain it across orientation changes.
    viewer.panBy(-195, 195);
    assert.ok(Math.abs(state.view!.center.x) < 1e-7);
    assert.ok(Math.abs(state.view!.center.y) < 1e-7);
    viewport = { width: 844, height: 390 };
    resize();
    assert.ok(Math.abs(state.view!.center.x) < 1e-7);
    assert.ok(Math.abs(state.view!.center.y) < 1e-7);
    // A larger viewport also raises the minimum zoom without shifting the corner.
    viewport = { width: 844, height: 600 };
    resize();
    assert.ok(Math.abs(state.view!.center.x) < 1e-7);
    assert.ok(Math.abs(state.view!.center.y) < 1e-7);
    assert.equal(state.view!.scale, 600 / 512);
    viewport = { width: 390, height: 844 };
    resize();
    viewer.fit(false);
    assert.deepEqual(state.view!.center, { x: 256, y: 256 });
    // Modified keys belong to the browser (⌘+ zooms the page, ⌥← goes back).
    const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => {
      const event = new window.Event("keydown", { cancelable: true });
      Object.defineProperties(event, Object.fromEntries(
        Object.entries({ key, ...modifiers }).map(([name, value]) => [name, { value }]),
      ));
      canvas.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const fitted = structuredClone(state.view);
    assert.equal(press("=", { metaKey: true }), false);
    assert.equal(press("ArrowLeft", { altKey: true }), false);
    assert.equal(press("-", { ctrlKey: true }), false);
    assert.deepEqual(state.view, fitted);
    const panned = () => (viewer as unknown as { camera: Camera }).camera.x;
    let before = panned();
    assert.equal(press("ArrowLeft"), true);
    assert.notDeepEqual(state.view, fitted);
    assert.equal(panned() - before, 60);
    before = panned();
    assert.equal(press("ArrowRight", { shiftKey: true }), true);
    assert.equal(before - panned(), 195, "Shift pans half a screen");
    // Quick presses add up: each one starts from where the last was heading.
    viewer.fit(false);
    const scale = () => (viewer as unknown as { camera: Camera }).camera.scale;
    const start = scale();
    press("+");
    step(performance.now() + 100);
    press("+");
    step(performance.now() + 1000);
    assert.ok(Math.abs(scale() / start - 2.25) < 1e-9, `zoomed ${scale() / start}×`);
    viewer.fit(false);
    state.touchLocked = true;
    viewer.updateNavigation(state);
    const saved = structuredClone(state.view);
    viewer.panBy(60, 0);
    viewer.zoomBy(2);
    viewer.fit();
    assert.deepEqual(state.view, saved);
    state.inverted = false;
    viewer.updateNavigation(state);
    assert.equal(canvas.style.filter, "brightness(0.4)");
    assert.equal(overlay.style.opacity, "0.6");
    // The default dim keeps routes and places at full strength.
    state.dimming = defaultNavigation(map.id).dimming;
    assert.ok(state.dimming < 1);
    viewer.updateNavigation(state);
    assert.equal(canvas.style.filter, `brightness(${state.dimming})`);
    assert.equal(overlay.style.opacity, "1");

    // Editing a route: its points drag; a point snapped onto a place moves
    // alone, and dropping one on a place snaps it there.
    state.touchLocked = false;
    const place = state.markers[0]!;
    state.routes.push({
      id: "route",
      name: "Route",
      points: [place.point, { x: 100, y: 100 }],
      created: 0,
      draft: true,
    });
    viewer.updateNavigation(state);
    const internals = viewer as unknown as {
      camera: Camera;
      grab(screen: Point): boolean;
      drop(screen: Point): void;
      tap(screen: Point): boolean;
    };
    const screen = (p: Point) => worldToScreen(internals.camera, p);
    assert.equal(internals.grab(screen(place.point)), false, "not while browsing");
    viewer.setTool("route", "route");
    assert.equal(internals.grab(screen({ x: 450, y: 450 })), false, "only on points");
    assert.equal(internals.grab(screen(place.point)), true);
    internals.drop(screen({ x: 300, y: 200 }));
    const [first, second] = state.routes[0]!.points;
    assert.deepEqual(
      [Math.round(first!.x), Math.round(first!.y)],
      [300, 200],
    );
    assert.deepEqual(place.point, { x: 256, y: 256 }, "the place stays put");
    assert.equal(internals.grab(screen(second!)), true);
    internals.drop(screen({ x: 258, y: 255 }));
    assert.deepEqual(state.routes[0]!.points[1], { x: 256, y: 256 });
    assert.notEqual(state.routes[0]!.points[1], place.point);
    assert.equal(internals.grab(screen(place.point)), true);
    internals.drop(screen({ x: -400, y: 900 }));
    assert.deepEqual(state.routes[0]!.points[1], { x: 0, y: 512 }, "kept on the map");
    assert.deepEqual(drops, [true, true, true]);
    // Moving a place: only that pin is grabbed.
    viewer.setTool("move", place.id);
    assert.equal(internals.grab(screen({ x: 0, y: 512 })), false);
    assert.equal(internals.grab(screen(place.point)), true);
    internals.drop(screen({ x: 128, y: 64 }));
    assert.deepEqual(
      [Math.round(place.point.x), Math.round(place.point.y)],
      [128, 64],
    );
    viewer.setTool("browse");
    // Jumping to a place glides there instead of cutting.
    const away = structuredClone(state.view);
    viewer.jumpTo({ x: 400, y: 120 });
    assert.deepEqual(state.view, away, "no cut");
    step(performance.now() + 300);
    assert.notDeepEqual(state.view, away);
    // Where pins crowd together, a tap opens the closest one, not the oldest.
    step(performance.now() + 600);
    const pin = screen(place.point);
    state.markers.push({
      id: "near", label: "Near", kind: "note", note: "", created: 0,
      point: screenToWorld(internals.camera, { x: pin.x + 16, y: pin.y }),
    });
    viewer.updateNavigation(state);
    assert.equal(internals.tap({ x: pin.x + 12, y: pin.y }), true);
    assert.equal(internals.tap({ x: pin.x + 2, y: pin.y }), true);
    assert.deepEqual(opened, ["near", place.id]);
  } finally {
    viewer.dispose();
    // Settle already-started bitmap loads, which must close after disposal.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(errors, []);
    assert.equal(nativeStats.decodedBytes, 0);
    await rm(root, { recursive: true, force: true });
  }
});
