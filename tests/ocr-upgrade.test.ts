import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { database, listMaps } from "../src/storage/database";
import { loadNavigation, lastMap } from "../src/storage/navigation";
import { loadOcr } from "../src/storage/ocr";
import { defaultNavigation } from "../src/viewer/navigation";

test("OCR migration preserves version 2 maps, camera, places, routes and settings", async () => {
  const state = defaultNavigation("old-map");
  state.view = { center: { x: 100, y: 200 }, scale: 0.5, rotation: 1 };
  state.markers.push({
    id: "place",
    label: "Gate",
    point: { x: 100, y: 200 },
    kind: "landmark",
    note: "",
    created: 1,
  });
  state.routes.push({
    id: "route",
    name: "Exit",
    points: [
      { x: 100, y: 200 },
      { x: 300, y: 400 },
    ],
    created: 1,
    draft: false,
  });
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("map-viewer", 2);
    request.onupgradeneeded = () => {
      for (const store of ["maps", "navigation"])
        request.result.createObjectStore(store, {
          keyPath: store === "maps" ? "id" : "mapId",
        });
      request.result.createObjectStore("payloads");
      request.result.createObjectStore("settings");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(
        ["maps", "navigation", "settings"],
        "readwrite",
      );
      tx.objectStore("maps").put({
        id: "old-map",
        name: "Old map",
        status: "ready",
      });
      tx.objectStore("navigation").put(state);
      tx.objectStore("settings").put("old-map", "last-map");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  assert.equal((await database()).version, 3);
  assert.equal((await listMaps())[0]?.name, "Old map");
  const restored = await loadNavigation("old-map");
  assert.deepEqual(restored.view, state.view);
  assert.deepEqual(restored.markers, state.markers);
  assert.deepEqual(restored.routes, state.routes);
  assert.equal(await lastMap(), "old-map");
  assert.equal(await loadOcr("old-map"), undefined);
});
