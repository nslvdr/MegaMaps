import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { BACKUP_INTERVAL, UNPROTECTED_BACKUP_INTERVAL, backupDue, createBackup, isBackupFile, readBackup, restoreBackup } from "../src/storage/backup";
import { inMemory, listMaps, saveMap } from "../src/storage/database";
import { loadNavigation, saveNavigation } from "../src/storage/navigation";
import { loadOcr, saveOcr } from "../src/storage/ocr";
import { deleteAllData, deleteStoredMap, payloadStore } from "../src/storage/payloads";
import { loadPhoto, savePhoto } from "../src/storage/photos";
import { loadSetting, saveSetting } from "../src/storage/settings";
import { defaultNavigation } from "../src/viewer/navigation";
import type { MapRecord } from "../src/types";

function image(salt: string) {
  const header = new Uint8Array(33);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  header.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(header.buffer).setUint32(16, 512);
  new DataView(header.buffer).setUint32(20, 256);
  return new File([header, salt], "original.png", { type: "image/png" });
}
const record = (id: string, name: string): MapRecord => ({ id, name, width: 512, height: 256, bytes: 0,
  backend: "indexeddb", levels: [{ width: 512, height: 256, scale: 1, cols: 1, rows: 1 }], created: 5, opened: 9, status: "ready" });
// Stands in for the tiling importer: stores the original under the requested identity.
const rebuilt: string[] = [];
const create = async (file: File, onProgress: (progress: { fraction: number; message: string }) => void, _signal: AbortSignal, id?: string) => {
  rebuilt.push(file.name);
  const map = { ...record(id!, file.name), created: Date.now(), opened: undefined };
  await saveMap(map);
  await payloadStore(map.backend).put(map.id, "original", file);
  onProgress({ fraction: 1, message: "Done" });
  return map;
};

test("a backup restores every map's places, routes, photos, view and text detection, and only once", async () => {
  await saveSetting("share-name", "Alex");
  for (const id of ["north", "south"]) {
    await saveMap(record(id, `${id} quarry`));
    await payloadStore("indexeddb").put(id, "original", image(id));
  }
  const photo = await savePhoto("north", new Blob(["jpeg bytes"], { type: "image/jpeg" }));
  await saveNavigation({ ...defaultNavigation("north"), inverted: false, northOffset: 30,
    markers: [{ id: "m", label: "Gate", description: "Locked", kind: "entrance", point: { x: 1, y: 2 }, created: 1, photos: [photo] }],
    routes: [{ id: "r", name: "Way out", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], created: 2, draft: false }] });
  await saveOcr({ mapId: "north", version: 2, completedAt: 7, lines: [{ text: "Gallery", confidence: 0.9, words: [] }] });

  const { file } = await createBackup(new Date(2022, 0, 12, 9, 5));
  assert.equal(file.name, "Backup 2022-01-12 09-05.megabackup");
  assert.ok(await isBackupFile(file));
  const north = await loadNavigation("north");

  // A new phone: nothing stored but the backup file.
  for (const map of await listMaps()) await deleteStoredMap(map);
  await saveSetting("share-name", "");
  const backup = await readBackup(file);
  assert.deepEqual(await restoreBackup(backup, () => {}, new AbortController().signal, create), { added: 2, kept: 0 });
  assert.deepEqual(rebuilt, ["north quarry", "south quarry"]);
  const maps = await listMaps();
  assert.deepEqual(maps.map(({ id, name, created, opened }) => ({ id, name, created, opened })), [
    { id: "north", name: "north quarry", created: 5, opened: 9 },
    { id: "south", name: "south quarry", created: 5, opened: 9 },
  ]);
  assert.deepEqual(await loadNavigation("north"), north);
  assert.equal(await (await loadPhoto("north", photo))!.text(), "jpeg bytes");
  assert.equal((await loadOcr("north"))?.lines[0]?.text, "Gallery");
  assert.equal(await (await payloadStore("indexeddb").get("south", "original")).text(), await image("south").text());
  assert.equal(await loadSetting("share-name"), "Alex");

  // Restoring again keeps what is already here instead of duplicating it.
  assert.deepEqual(await restoreBackup(backup, () => {}, new AbortController().signal, create), { added: 0, kept: 2 });
  assert.equal(rebuilt.length, 2);
});

test("an in-memory copy keeps every byte and the type of a large picked file", async () => {
  const bytes = new Uint8Array(9 * 1024 * 1024 + 5).map((_, index) => index % 251);
  const copy = await inMemory(new File([bytes], "map.jpg", { type: "image/jpeg" }).slice(3, bytes.length, "image/jpeg"));
  assert.equal(copy.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await copy.arrayBuffer()), bytes.subarray(3));
});

test("damaged, truncated and foreign files are refused before anything is written", async () => {
  const { file } = await createBackup();
  await assert.rejects(readBackup(file.slice(0, file.size - 1)), /incomplete|damaged/);
  await assert.rejects(readBackup(new Blob(["MEGAMAP1 a shared map"])), /backup file saved by Mega Maps/);
  const json = (value: unknown) => {
    const body = new TextEncoder().encode(JSON.stringify(value));
    const header = new Uint8Array(12);
    header.set(new TextEncoder().encode("MEGABAK1"));
    new DataView(header.buffer).setUint32(8, body.length, true);
    return new Blob([header, body]);
  };
  await assert.rejects(readBackup(json({ format: "megamaps-backup", version: 2, createdAt: 1, maps: [] })), /newer Mega Maps/);
  const map = { id: "../escape", name: "x", created: 1, image: { type: "image/png", bytes: 1 }, photos: [], navigation: { markers: [], routes: [] } };
  await assert.rejects(readBackup(json({ format: "megamaps-backup", version: 1, createdAt: 1, maps: [map] })), /damaged/);
  const badPoint = { ...map, id: "ok", navigation: { markers: [{ id: "m", label: "a", point: { x: "1", y: 2 } }], routes: [] } };
  await assert.rejects(readBackup(json({ format: "megamaps-backup", version: 1, createdAt: 1, maps: [badPoint] })), /damaged/);
});

test("a backup is due once a month has passed with maps added or opened since the last one", () => {
  const now = 100 * 86_400_000;
  const map = { created: now - 90 * 86_400_000, opened: now - 86_400_000 };
  assert.equal(backupDue([], undefined, now), false, "nothing to back up yet");
  assert.equal(backupDue([map], undefined, now), true, "never backed up");
  assert.equal(backupDue([map], now - BACKUP_INTERVAL + 1, now), false, "the last backup is recent");
  assert.equal(backupDue([map], now - BACKUP_INTERVAL, now), true, "the map was opened after an old backup");
  assert.equal(backupDue([{ created: map.created }], now - BACKUP_INTERVAL, now), false, "nothing changed since the old backup");
});

test("a backup is due weekly while the browser may clear the library", () => {
  const now = 100 * 86_400_000;
  const map = { created: now - 90 * 86_400_000, opened: now - 86_400_000 };
  assert.equal(backupDue([map], now - UNPROTECTED_BACKUP_INTERVAL, now, false), true);
  assert.equal(backupDue([map], now - UNPROTECTED_BACKUP_INTERVAL + 1, now, false), false, "the last backup is recent");
  assert.equal(backupDue([map], now - UNPROTECTED_BACKUP_INTERVAL, now, true), false, "protected storage waits a month");
});

test("deleting everything removes every map with its data and the saved settings", async () => {
  for (const id of ["east", "west"]) {
    await saveMap(record(id, `${id} quarry`));
    await payloadStore("indexeddb").put(id, "original", image(id));
    await saveNavigation({ ...defaultNavigation(id), markers: [{ id: "m", kind: "entrance", label: "Gate", description: "", point: { x: 1, y: 2 }, created: 1 }] });
  }
  await saveSetting("share-name", "Alex");
  await saveSetting("last-backup", 7);
  await deleteAllData();
  assert.deepEqual(await listMaps(), []);
  await assert.rejects(payloadStore("indexeddb").get("east", "original"));
  assert.equal((await loadNavigation("west")).markers.length, 0);
  assert.equal(await loadSetting("share-name"), undefined);
  assert.equal(await loadSetting("last-backup"), undefined);
});
