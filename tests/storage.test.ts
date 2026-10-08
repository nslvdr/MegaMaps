import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { payloadStore, deleteStoredMap } from "../src/storage/payloads";
import { listMaps, saveMap, renameMap, removeRecord } from "../src/storage/database";
import { loadNavigation, saveNavigation } from "../src/storage/navigation";
import { defaultNavigation } from "../src/viewer/navigation";
import type { MapRecord } from "../src/types";
test("fallback payloads persist and deleting one map preserves its neighbour", async () => {
  const store = payloadStore("indexeddb");
  await store.put("a", "original", new Blob(["a"]));
  await store.put("a", "0-0-0.png", new Blob(["tile"]));
  await store.put("ab", "original", new Blob(["neighbour"]));
  assert.equal(await (await store.get("a", "original")).text(), "a");
  const map: MapRecord = {
    id: "a",
    name: "map",
    width: 1,
    height: 1,
    bytes: 1,
    backend: "indexeddb",
    levels: [],
    created: 0,
    status: "importing",
  };
  await saveMap(map);
  assert.equal(
    (await listMaps()).find((m) => m.id === "a")?.status,
    "importing",
  );
  await deleteStoredMap(map);
  await assert.rejects(store.get("a", "original"));
  await assert.rejects(store.get("a", "0-0-0.png"));
  assert.equal(await (await store.get("ab", "original")).text(), "neighbour");
  assert.ok(!(await listMaps()).some((m) => m.id === "a"));
  await store.deleteMap("ab");
});

test("renaming persists only the name and preserves map payloads and navigation", async () => {
  const map: MapRecord = {
    id: "rename", name: "original.png", width: 512, height: 512,
    bytes: 100, backend: "indexeddb", levels: [], created: 1, status: "ready",
    offlineVerifiedAt: 123,
  };
  await saveMap(map);
  const store = payloadStore(map.backend);
  await store.put(map.id, "0-0-0.png", new Blob(["tile"]));
  const navigation = defaultNavigation(map.id);
  navigation.markers.push({ id: "place", label: "Entrance", kind: "entrance", point: { x: 10, y: 20 }, note: "", created: 1 });
  await saveNavigation(navigation);
  await renameMap(map.id, "  Cave survey  ");
  assert.deepEqual((await listMaps()).find((record) => record.id === map.id), {
    ...map, name: "Cave survey",
  });
  assert.equal(await (await store.get(map.id, "0-0-0.png")).text(), "tile");
  assert.deepEqual(await loadNavigation(map.id), navigation);
  await assert.rejects(renameMap(map.id, " \n "), /Enter a map name/);
  assert.equal((await listMaps()).find((record) => record.id === map.id)?.name, "Cave survey");
  await deleteStoredMap({ ...map, name: "Cave survey" });
});

test("renaming cannot recreate a deleted map or change an unavailable map", async () => {
  await assert.rejects(renameMap("removed", "New name"), /no longer available/);
  assert.ok(!(await listMaps()).some((map) => map.id === "removed"));
  const map: MapRecord = {
    id: "unavailable", name: "original", width: 1, height: 1, bytes: 1,
    backend: "indexeddb", levels: [], created: 0, status: "deleting",
  };
  await saveMap(map);
  await assert.rejects(renameMap(map.id, "New name"), /no longer available/);
  assert.deepEqual((await listMaps()).find((record) => record.id === map.id), map);
  await removeRecord(map.id);
});
