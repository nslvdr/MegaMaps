import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraAt,
  constrain,
  fitCamera,
  screenToWorld,
  worldToScreen,
  transformAt,
  visibleTiles,
} from "../src/viewer/camera";
import {
  defaultNavigation,
  captureView,
  restoreView,
} from "../src/viewer/navigation";
import { pyramid } from "../src/processing/pyramid";
import { database, saveMap, transact } from "../src/storage/database";
import {
  saveNavigation,
  loadNavigation,
  setLastMap,
  lastMap,
  NavigationPersistence,
} from "../src/storage/navigation";
import { deleteStoredMap } from "../src/storage/payloads";
import type { MapRecord } from "../src/types";
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const pointNear = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => {
  near(a.x, b.x);
  near(a.y, b.y);
};
const map = (id: string): MapRecord => ({
  id,
  name: "cave.png",
  width: 9000,
  height: 4000,
  bytes: 100,
  backend: "indexeddb",
  levels: pyramid(9000, 4000),
  created: 0,
  status: "ready",
});

test("rotation inverse, pinch anchor, rotated fit and viewport tile coverage", () => {
  const image = { width: 9000, height: 4000 },
    viewport = { width: 390, height: 844 };
  for (const rotation of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 3]) {
    const camera = cameraAt({ x: 4500, y: 2000 }, viewport, 0.4, rotation);
    const world = { x: 4700, y: 2075 };
    pointNear(screenToWorld(camera, worldToScreen(camera, world)), world);
    const anchor = { x: 100, y: 300 };
    pointNear(
      screenToWorld(transformAt(camera, 0.8, rotation + 0.3, anchor), anchor),
      screenToWorld(camera, anchor),
    );
    const fit = fitCamera(image, viewport, rotation);
    for (const p of [
      { x: 0, y: 0 },
      { x: 9000, y: 0 },
      { x: 0, y: 4000 },
      { x: 9000, y: 4000 },
    ]) {
      const screen = worldToScreen(fit, p);
      assert.ok(
        screen.x >= -1e-7 &&
          screen.y >= -1e-7 &&
          screen.x <= 390 + 1e-7 &&
          screen.y <= 844 + 1e-7,
      );
    }
    const visible = visibleTiles(pyramid(9000, 4000)[0]!, camera, viewport);
    for (let y = 0; y <= 844; y += 31)
      for (let x = 0; x <= 390; x += 29) {
        const p = screenToWorld(camera, { x, y });
        if (p.x < 0 || p.y < 0 || p.x >= 9000 || p.y >= 4000) continue;
        assert.ok(
          visible.some(
            (t) =>
              t.x === Math.floor(p.x / 512) && t.y === Math.floor(p.y / 512),
          ),
        );
      }
  }
  const bounded = constrain(
    { x: 5000, y: -10000, scale: 0.5, rotation: Math.PI / 2 },
    image,
    viewport,
  );
  assert.ok(Number.isFinite(bounded.x) && Number.isFinite(bounded.y));
});
test("saved center/zoom/rotation survive a changed device viewport", () => {
  const view = captureView(
    cameraAt({ x: 4231, y: 2131 }, { width: 390, height: 844 }, 0.8, 1.3),
    { width: 390, height: 844 },
  );
  const restored = restoreView(view, { width: 844, height: 390 });
  pointNear(screenToWorld(restored, { x: 422, y: 195 }), view.center);
  near(restored.scale, 0.8);
  near(restored.rotation!, 1.3);
});
test("notes, routes and settings persist; deletion blocks late writes", async () => {
  const record = map("nav");
  await saveMap(record);
  const state = defaultNavigation("nav");
  state.inverted = true;
  state.rotationLocked = false;
  state.touchLocked = true;
  state.dimming = 0.4;
  state.view = { center: { x: 2000, y: 1000 }, scale: 0.7, rotation: 1.2 };
  state.markers.push({
    id: "marker",
    point: { x: 500, y: 700 },
    label: "Entrance",
    kind: "entrance",
    note: "Second opening",
    created: 1,
  });
  state.routes.push({
    id: "route",
    name: "Return plan",
    points: [
      { x: 500, y: 700 },
      { x: 900, y: 800 },
    ],
    created: 1,
    draft: false,
  });
  await saveNavigation(state);
  await setLastMap("nav");
  assert.equal(await lastMap(), "nav");
  assert.deepEqual(await loadNavigation("nav"), state);
  const persistence = new NavigationPersistence(
    () => state,
    (error) => assert.fail(String(error)),
  );
  state.dimming = 0.2;
  persistence.changed();
  const first = persistence.flush();
  state.dimming = 0.8;
  persistence.changed();
  await persistence.flush();
  await first;
  assert.equal((await loadNavigation("nav")).dimming, 0.8);
  await deleteStoredMap(record);
  await saveNavigation(state);
  assert.equal(
    await transact("navigation", "readonly", (s) => s.get("nav")),
    undefined,
  );
  await setLastMap(null);
  assert.equal(await lastMap(), null);
});

test("legacy bookmarks become landmarks on load and survive queued saves", async () => {
  const mapId = "merged-point-types";
  await saveMap(map(mapId));
  const bookmark = {
    id: "old-bookmark", kind: "bookmark" as const, label: "Waterfall",
    note: "Stay left", point: { x: 150, y: 250 }, created: 7,
  };
  const landmark = { ...bookmark, id: "old-landmark", kind: "landmark" as const };
  const stored = { ...defaultNavigation(mapId), markers: [bookmark, landmark],
    importedItems: [`marker:${bookmark.id}`] };
  await transact("navigation", "readwrite", (s) => s.put(stored));
  const migrated = { ...bookmark, kind: "landmark" };
  assert.deepEqual((await loadNavigation(mapId)).markers, [migrated, landmark]);
  assert.equal(stored.markers[0]!.kind, "bookmark", "loading does not mutate the input");

  // A queued snapshot predates the bookmark import; reconciliation must migrate it too.
  const queued = defaultNavigation(mapId);
  queued.markers = [landmark];
  await saveNavigation(queued);
  assert.deepEqual(await transact("navigation", "readonly", (s) => s.get(mapId)),
    { ...queued, markers: [landmark, migrated], importedItems: stored.importedItems });
  assert.deepEqual((await loadNavigation(mapId)).markers, [landmark, migrated]);
});

test("update preparation saves pending changes and blocks reload after a failed write", async () => {
  await saveMap(map("update-save"));
  const state = defaultNavigation("update-save");
  const errors: unknown[] = [];
  const persistence = new NavigationPersistence(() => state, (error) => errors.push(error));
  state.dimming = 0.45;
  persistence.changed();
  await persistence.flushForReload();
  assert.equal((await loadNavigation(state.mapId)).dimming, 0.45);

  const db = await database();
  const transaction = db.transaction;
  try {
    db.transaction = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
    state.dimming = 0.7;
    persistence.changed();
    await assert.rejects(persistence.flushForReload(), /could not be saved/);
    assert.equal(errors.length, 1);
  } finally {
    db.transaction = transaction;
  }
  await persistence.flushForReload();
  assert.equal((await loadNavigation(state.mapId)).dimming, 0.7, "retry retains the unsaved change");
});
