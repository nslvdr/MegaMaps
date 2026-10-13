import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Viewer } from "../src/viewer/viewer";
import { cameraAt, screenToWorld, worldToScreen, type Camera, type Point } from "../src/viewer/camera";
import { BRIGHTNESS_LEVELS, defaultNavigation } from "../src/viewer/navigation";
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
    description: "",
    point: { x: 256, y: 256 },
    created: 0,
  });
  const overlay = document.querySelector<SVGSVGElement>("svg")!;
  const errors: string[] = [],
    drops: boolean[] = [],
    opened: string[] = [],
    openedRoutes: string[] = [],
    taps: Point[] = [];
  let emptyTaps = 0;
  const viewer = new Viewer(
    canvas,
    map,
    () => {},
    (error) => errors.push(error),
    {
      navigation: state,
      overlay,
      onView() {},
      onTap: (point) => taps.push(point),
      onMarker: (marker) => opened.push(marker.id),
      onRoute: (route) => openedRoutes.push(route.id),
      onEmptyTap: () => emptyTaps++,
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
    assert.equal(Number(overlay.style.opacity || "1"), 1, "annotations start fully opaque even on a dim map");
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
    viewer.fit();
    step(performance.now() + 100);
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    step(performance.now() + 300);
    viewer.fit(); // Fitting an already-fitted rotated map must keep its angle mid-animation.
    step(performance.now() + 100);
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    step(performance.now() + 300);
    // Auto rotation eases toward the compass, the short way round, about the
    // middle of the map; it never jumps, even when readings do.
    let time = performance.now() + 1000;
    const center = { ...state.view!.center };
    viewer.orient(0);
    step((time += 16));
    const turned = viewer.diagnostics().rotation;
    assert.ok(turned < Math.PI / 2 && turned > Math.PI / 3, "each frame turns a little");
    for (let i = 0; i < 150; i++) step((time += 16));
    assert.equal(viewer.diagnostics().rotation, 0);
    assert.ok(Math.hypot(state.view!.center.x - center.x, state.view!.center.y - center.y) < 0.5);
    viewer.orient(2 * Math.PI - 0.2);
    step((time += 16));
    assert.ok(viewer.diagnostics().rotation < 0, "turning 0.2 back, not 6 forward");
    viewer.orient(Math.PI / 2);
    for (let i = 0; i < 150; i++) step((time += 16));
    viewer.orient(undefined);
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
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
    const scale = () => (viewer as unknown as { camera: Camera }).camera.scale;
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
    assert.equal(Number(overlay.style.opacity || "1"), 1);
    // Map brightness never changes annotation opacity, in either display mode.
    for (const inverted of [true, false]) {
      state.inverted = inverted;
      for (const dimming of BRIGHTNESS_LEVELS) {
        state.dimming = dimming;
        viewer.updateNavigation(state);
        const filter: string = canvas.style.filter;
        assert.equal(Number(overlay.style.opacity || "1"), 1, `annotations stay opaque at ${dimming} brightness`);
        assert.equal(overlay.style.filter, "");
        if (inverted) assert.match(filter, /^invert\(1\)/);
        else assert.equal(filter, dimming < 1 ? `brightness(${dimming})` : "");
        if (dimming < 1) assert.ok(filter.endsWith(`brightness(${dimming})`));
      }
    }
    state.dimming = defaultNavigation(map.id).dimming;
    assert.ok(state.dimming < 1);
    viewer.updateNavigation(state);
    assert.equal(canvas.style.filter, `brightness(${state.dimming})`);
    assert.equal(Number(overlay.style.opacity || "1"), 1);

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
      cursorAt(screen: Point): string;
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
    // Selecting a landmark zooms to native detail and keeps it above the open card.
    viewer.fit(false);
    viewer.jumpTo(place.point, 1);
    const revealed = viewer.reveal(place.point, 400);
    step(performance.now() + 300);
    assert.equal(scale(), 1);
    assert.equal(viewer.diagnostics().rotation, Math.PI / 2);
    assert.ok(Math.abs(screen(place.point).x - revealed.x) < 1e-7);
    assert.ok(Math.abs(screen(place.point).y - revealed.y) < 1e-7);
    assert.ok(revealed.y <= 360, "the landmark stays clear of the card");
    viewer.zoomBy(1.5);
    step(performance.now() + 300);
    const closer = scale();
    viewer.jumpTo(place.point, 1);
    step(performance.now() + 300);
    assert.equal(scale(), closer, "selecting a place never zooms out from a closer view");
    // Reading panes cover the bottom of a full-size map. Even rotated map
    // corners must center in the portrait/landscape area left above them.
    const positioning = viewer as unknown as { setCamera(camera: Camera): void };
    for (const area of [{ width: 390, height: 844, edge: 422 },
      { width: 844, height: 390, edge: 195 }, { width: 390, height: 844, edge: 140 }]) {
      viewport = area;
      resize();
      viewer.fit(false);
      const fittedScale = scale();
      viewer.cover(area.edge);
      for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
        positioning.setCamera({ ...internals.camera, rotation });
        for (const point of [{ x: 0, y: 0 }, { x: 512, y: 512 }]) {
          viewer.jumpTo(point, 1);
          resize(); // A duplicate observer callback must not cancel the glide.
          step(performance.now() + 300);
          const centered = screen(point);
          assert.ok(Math.abs(centered.x - area.width / 2) < 1e-7);
          assert.ok(Math.abs(centered.y - area.edge / 2) < 1e-7);
          assert.equal(viewer.diagnostics().rotation, rotation);
          assert.ok(scale() >= fittedScale, "opening or expanding details never zooms out");
        }
      }
    }
    viewport = { width: 390, height: 844 };
    resize();
    for (const edge of [422, 418, 413, 407, 400]) {
      viewer.cover(edge);
      viewer.jumpTo({ x: 512, y: 512 }, 1, false);
      const centered = screen({ x: 512, y: 512 });
      assert.ok(Math.abs(centered.x - 195) < 1e-7);
      assert.ok(Math.abs(centered.y - edge / 2) < 1e-7,
        "the place follows each small pane movement immediately");
      step(performance.now() + 300);
      assert.ok(Math.abs(screen({ x: 512, y: 512 }).y - edge / 2) < 1e-7);
    }
    // Closing the pane eases a map edge back from mid-screen.
    viewer.cover();
    step(performance.now() + 300);
    assert.ok(Math.abs(screen({ x: 512, y: 512 }).y - 422) < 1e-7);
    viewport = { width: 390, height: 844 };
    resize();
    viewer.jumpTo(place.point, 1);
    step(performance.now() + 300);
    // Where pins crowd together, a tap opens the closest one, not the oldest.
    step(performance.now() + 600);
    const pin = screen(place.point);
    state.markers.push({
      id: "near", label: "Near", kind: "landmark", description: "", created: 0,
      point: screenToWorld(internals.camera, { x: pin.x + 16, y: pin.y }),
    });
    viewer.updateNavigation(state);
    assert.equal(internals.tap({ x: pin.x + 12, y: pin.y }), true);
    assert.equal(internals.tap({ x: pin.x + 2, y: pin.y }), true);
    assert.deepEqual(opened, ["near", place.id]);
    assert.equal(emptyTaps, 0);
    assert.equal(internals.tap({ x: pin.x + 120, y: pin.y + 120 }), false,
      "an empty tap stays free to start a double-tap zoom");
    assert.equal(emptyTaps, 1, "and tells the controls nothing was hit");

    // Route lines are selectable at a fixed screen distance, even when zoomed or rotated.
    state.markers = [];
    state.layers.labels = false;
    state.routes = [
      { id: "first-line", name: "First", created: 0, draft: false,
        points: [{ x: 100, y: 256 }, { x: 412, y: 256 }] },
      { id: "near-line", name: "Near", created: 0, draft: false,
        points: [{ x: 100, y: 266 }, { x: 412, y: 266 }] },
    ];
    viewer.updateNavigation(state);
    for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
      for (const zoom of [0.8, 2]) {
        positioning.setCamera(cameraAt({ x: 256, y: 256 }, viewport, zoom, rotation));
        const mid = screen({ x: 256, y: 256 });
        const near = { x: mid.x - Math.sin(rotation) * 12, y: mid.y + Math.cos(rotation) * 12 };
        assert.equal(internals.cursorAt(near), "pointer");
        assert.equal(internals.tap(near), true, "a tap near the line opens its details");
        assert.equal(openedRoutes.at(-1), "near-line", "the closest route wins");
        assert.equal(internals.tap(mid), true);
        assert.equal(openedRoutes.at(-1), "first-line");
        const far = { x: mid.x + Math.sin(rotation) * 20, y: mid.y - Math.cos(rotation) * 20 };
        assert.equal(internals.tap(far), false, "taps beyond the line's reach stay free for zooming");
      }
    }
    const mid = screen({ x: 256, y: 256 });
    state.markers = [{ ...place, id: "on-route", point: { x: 256, y: 256 } }];
    viewer.updateNavigation(state);
    const routeCount = openedRoutes.length;
    assert.equal(internals.tap(mid), true);
    assert.equal(opened.at(-1), "on-route", "a place on the route still opens its own details");
    assert.equal(openedRoutes.length, routeCount);
    state.markers = [];
    state.layers.routes = false;
    viewer.updateNavigation(state);
    assert.equal(internals.tap(mid), false, "hidden route lines cannot be selected");
    assert.equal(internals.cursorAt(mid), "");
    assert.equal(openedRoutes.length, routeCount);

    // Name chips select the same route as its line.
    state.layers.routes = state.layers.labels = true;
    viewer.updateNavigation(state);
    step(performance.now() + 300);
    const chip = [...overlay.querySelectorAll<SVGGElement>(".map-callout")]
      .find((callout) => callout.querySelector("text")!.textContent === "First")!;
    const [x, y] = chip.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
    assert.equal(internals.tap({ x: x! + 2, y: y! + 2 }), true);
    assert.equal(openedRoutes.at(-1), "first-line");

    const selectedCount = openedRoutes.length;
    viewer.setTool("route", "first-line");
    assert.equal(internals.tap(mid), true);
    assert.equal(openedRoutes.length, selectedCount, "point editing keeps taps on the drawing tool");
    viewer.setTool("browse");

    // A route centers in the map area above the moving details pane.
    const shortRoute = [{ x: 200, y: 240 }, { x: 300, y: 270 }];
    for (const edge of [422, 418, 407, 400]) {
      viewer.cover(edge);
      viewer.fitPoints(shortRoute, false);
      const center = screen({ x: 250, y: 255 });
      assert.ok(Math.abs(center.x - viewport.width / 2) < 1e-7);
      assert.ok(Math.abs(center.y - edge / 2) < 1e-7);
      assert.ok(shortRoute.every((point) => screen(point).y > 0 && screen(point).y < edge));
      step(performance.now() + 300);
      assert.ok(Math.abs(screen({ x: 250, y: 255 }).y - edge / 2) < 1e-7,
        "scrolling the card does not leave a delayed camera animation");
    }
  } finally {
    viewer.dispose();
    // Settle already-started bitmap loads, which must close after disposal.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(errors, []);
    assert.equal(nativeStats.decodedBytes, 0);
    await rm(root, { recursive: true, force: true });
  }
});
