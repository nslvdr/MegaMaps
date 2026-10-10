import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeShare, fingerprint, isShareFile, MAX_MANIFEST_BYTES, readShare, validateManifest, verifyImage, type ShareManifest } from "../src/sharing/format";
import { mergeAnnotations, preserveUnseenImports } from "../src/sharing/annotations";
import { exportFile, importAnnotations, importNewCopy, matchingMaps, prepareExport } from "../src/sharing/storage";
import { defaultNavigation } from "../src/viewer/navigation";
import { database, listMaps, saveMap } from "../src/storage/database";
import { loadNavigation, saveNavigation } from "../src/storage/navigation";
import { payloadStore } from "../src/storage/payloads";
import type { MapRecord } from "../src/types";

// A container header is enough for image identity checks; decoding stays in the existing importer.
function image(width = 512, height = 256, salt = "original") {
  const header = new Uint8Array(33);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  header.set(new TextEncoder().encode("IHDR"), 12);
  const view = new DataView(header.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([header, salt], "original.png", { type: "image/png" });
}
async function fixture() {
  const original = image();
  const manifest: ShareManifest = { format: "megamap", version: 1,
    map: { name: "Survey <2026>", width: 512, height: 256, fingerprint: await fingerprint(original) },
    markers: [{ id: "place-a", label: "Entrance <west>", note: "First line\nSecond line", point: { x: 12, y: 20 }, kind: "entrance", created: 1 }],
    routes: [{ id: "route-a", name: "Way out", points: [{ x: 12, y: 20 }, { x: 400, y: 200 }], draft: false, created: 2 }] };
  return { original, manifest };
}
const record = (id: string): MapRecord => ({ id, name: `${id}.png`, width: 512, height: 256,
  bytes: image().size, backend: "indexeddb", levels: [{ width: 512, height: 256, scale: 1, cols: 1, rows: 1 }], created: 0, status: "ready" });
const rawFile = (value: unknown, tail?: Blob) => {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("MEGAMAP1"));
  new DataView(header.buffer).setUint32(8, json.length, true);
  return new Blob(tail ? [header, json, tail] : [header, json]);
};

test("portable shares round trip annotations and optional original bytes", async () => {
  const { original, manifest } = await fixture();
  const annotations = await readShare(encodeShare(manifest));
  assert.deepEqual(annotations.manifest, manifest);
  assert.equal(annotations.image, undefined);
  const withImage = { ...manifest, image: { name: original.name, type: original.type, bytes: original.size } };
  const decoded = await readShare(encodeShare(withImage, original));
  assert.deepEqual(decoded.manifest, withImage);
  assert.deepEqual(await decoded.image!.arrayBuffer(), await original.arrayBuffer());
  await verifyImage(decoded.image!, manifest);
  const imageOnly = { ...withImage, markers: [], routes: [] };
  assert.equal((await readShare(encodeShare(imageOnly, original))).manifest.markers.length, 0);
});

test("older shared bookmarks import as landmarks and re-export with the merged type", async () => {
  const { manifest } = await fixture();
  const legacy = { ...manifest, markers: [{ ...manifest.markers[0]!, kind: "bookmark" }] };
  const decoded = await readShare(rawFile(legacy));
  assert.deepEqual(decoded.manifest.markers, [{ ...manifest.markers[0]!, kind: "landmark" }]);
  assert.deepEqual((await readShare(encodeShare(decoded.manifest))).manifest, decoded.manifest);

  const destination = { ...record("legacy-bookmark-import"), fingerprint: manifest.map.fingerprint };
  await saveMap(destination);
  await importAnnotations(destination.id, decoded.manifest);
  assert.deepEqual((await loadNavigation(destination.id)).markers, decoded.manifest.markers);
});

test("fingerprints read bounded chunks and agree with SHA-256", async () => {
  const bytes = new Uint8Array(3 * 1024 * 1024 + 17).fill(73);
  const blob = new Blob([bytes]);
  const requests: number[] = [];
  const slice = blob.slice.bind(blob);
  blob.slice = (start, end, type) => {
    requests.push((end ?? blob.size) - (start ?? 0));
    return slice(start, end, type);
  };
  blob.arrayBuffer = () => { throw new Error("Must not read the entire original"); };
  assert.equal(await fingerprint(blob), createHash("sha256").update(bytes).digest("hex"));
  assert.ok(requests.length > 1 && requests.every((size) => size <= 1024 * 1024));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fingerprint(blob, controller.signal), { name: "AbortError" });
});

test("import routing recognizes the shared header regardless of filename or MIME type", async () => {
  const { manifest, original } = await fixture();
  assert.equal(await isShareFile(new File([encodeShare(manifest)], "map.png", { type: "image/png" })), true);
  assert.equal(await isShareFile(new File([original], "map.megamap", { type: "application/octet-stream" })), false);
  assert.equal(await isShareFile(new Blob(["MEGAMAP"])), false);
  assert.equal(await isShareFile(new Blob()), false);
});

test("untrusted shares reject malformed manifests, excessive sizes, and truncated payloads", async () => {
  const { manifest, original } = await fixture();
  await assert.rejects(readShare(new Blob(["not a MegaMaps file"])), /exported by MegaMaps/);
  await assert.rejects(readShare(rawFile({ ...manifest, version: 2 })), /not supported/);
  await assert.rejects(readShare(rawFile({ ...manifest, map: { ...manifest.map, width: 0 } })), /invalid/);
  await assert.rejects(readShare(rawFile({ ...manifest, markers: [{ ...manifest.markers[0], point: { x: 513, y: 2 } }] })), /invalid/);
  await assert.rejects(readShare(rawFile({ ...manifest, markers: [{ ...manifest.markers[0], kind: "__proto__" }] })), /invalid/);
  await assert.rejects(readShare(rawFile({ ...manifest, markers: [manifest.markers[0], manifest.markers[0]] })), /invalid/);
  await assert.rejects(readShare(rawFile({ ...manifest, routes: [{ ...manifest.routes[0], draft: true }] })), /invalid/);
  await assert.rejects(readShare(rawFile({ ...manifest, routes: [{ ...manifest.routes[0], points: [{ x: 1, y: 2 }] }] })), /invalid/);
  await assert.rejects(readShare(rawFile({ ...manifest, image: { name: "../image.png", type: "image/png", bytes: original.size } }, original)), /invalid/);
  const included = encodeShare({ ...manifest, image: { name: "map.png", type: "image/png", bytes: original.size } }, original);
  await assert.rejects(readShare(included.slice(0, included.size - 1)), /incomplete/);
  await assert.rejects(readShare(new Blob([encodeShare(manifest), "extra"])), /unexpected/);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("MEGAMAP1"));
  new DataView(header.buffer).setUint32(8, MAX_MANIFEST_BYTES + 1, true);
  await assert.rejects(readShare(new Blob([header])), /invalid/);
  assert.throws(() => validateManifest({ ...manifest, markers: [], routes: [] }), /Select at least one/);
  assert.throws(() => validateManifest({ ...manifest, markers: [{ ...manifest.markers[0], point: { x: NaN, y: 2 } }] }), /invalid/);
});

test("repeat imports preserve edits and deleted items while later shares add new IDs", async () => {
  const { manifest } = await fixture();
  const state = defaultNavigation("destination");
  state.markers.push({ ...manifest.markers[0]!, id: "local", label: "My own place" });
  const first = mergeAnnotations(state, manifest);
  assert.equal(first.added, 2);
  first.state.markers.find((item) => item.id === "place-a")!.note = "My corrected note";
  first.state.routes = [];
  const later = { ...manifest, markers: [...manifest.markers, { ...manifest.markers[0]!, id: "new-place" }] };
  const second = mergeAnnotations(first.state, later);
  assert.equal(second.added, 1);
  assert.equal(second.skipped, 2);
  assert.equal(second.state.markers.find((item) => item.id === "place-a")!.note, "My corrected note");
  assert.equal(second.state.routes.length, 0, "locally deleted imports stay deleted");
  assert.equal(second.state.markers.find((item) => item.id === "local")!.label, "My own place");
  assert.equal(state.markers.length, 1, "merging does not mutate the original snapshot");
});

test("matching hashes originals rather than trusting filenames or dimensions; export selections stay independent", async () => {
  const { original, manifest } = await fixture();
  const same = record("renamed"), different = record("different");
  await saveMap(same);
  await saveMap(different);
  const store = payloadStore("indexeddb");
  await store.put(same.id, "original", original);
  await store.put(different.id, "original", image(512, 256, "other-image"));
  assert.deepEqual(await matchingMaps(manifest, [same, different]), [same.id]);
  const state = defaultNavigation(same.id);
  state.markers = manifest.markers;
  state.routes = [...manifest.routes, { ...manifest.routes[0]!, id: "draft", draft: true }];
  const prepared = await prepareExport(same, state);
  const file = exportFile(prepared, { markers: ["place-a"], routes: [], includeImage: false });
  assert.equal(file.name, "renamed.megamap");
  const decoded = await readShare(file);
  assert.equal(decoded.manifest.markers.length, 1);
  assert.equal(decoded.manifest.routes.length, 0);
  assert.equal(decoded.image, undefined);
  const full = await readShare(exportFile(prepared, { markers: [], routes: ["route-a"], includeImage: true }));
  assert.equal(full.manifest.routes.length, 1);
  assert.ok(full.image);
  assert.equal(state.routes.length, 2);
});

test("transactional imports preserve existing navigation and survive stale saves and concurrent imports", async () => {
  const { original, manifest } = await fixture();
  const map = { ...record("atomic"), fingerprint: manifest.map.fingerprint };
  await saveMap(map);
  await payloadStore(map.backend).put(map.id, "original", original);
  const state = defaultNavigation(map.id);
  state.dimming = 0.4;
  state.view = { center: { x: 40, y: 30 }, scale: 2, rotation: 1 };
  await saveNavigation(state);
  const results = await Promise.all([importAnnotations(map.id, manifest), importAnnotations(map.id, manifest)]);
  assert.deepEqual(results, [{ added: 2, skipped: 0, removed: 0 }, { added: 0, skipped: 2, removed: 0 }]);
  state.dimming = 0.6;
  await saveNavigation(state); // Old viewer snapshot has not seen the import yet.
  const saved = await loadNavigation(map.id);
  assert.equal(saved.markers.length, 1);
  assert.equal(saved.routes.length, 1);
  assert.equal(saved.dimming, 0.6);
  assert.deepEqual(saved.view, state.view);
  const refreshed = preserveUnseenImports(state, saved);
  refreshed.markers = [];
  await saveNavigation(refreshed);
  await importAnnotations(map.id, manifest);
  assert.equal((await loadNavigation(map.id)).markers.length, 0);
  await assert.rejects(importAnnotations("missing", manifest), /no longer available/);
  const wrong = { ...record("wrong"), fingerprint: "b".repeat(64) };
  await saveMap(wrong);
  await assert.rejects(importAnnotations(wrong.id, manifest), /same image/);
  await assert.rejects(importAnnotations(wrong.id, manifest, "replace"), /same image/);
  assert.equal((await loadNavigation(wrong.id)).markers.length, 0);
  const wrongSize = { ...record("wrong-size"), width: 1024, fingerprint: manifest.map.fingerprint };
  await saveMap(wrongSize);
  for (const mode of ["merge", "replace"] as const)
    await assert.rejects(importAnnotations(wrongSize.id, manifest, mode), /same dimensions/);
  assert.equal((await loadNavigation(wrongSize.id)).markers.length, 0);
});

test("replace swaps places and finished routes for the shared ones but keeps drafts and settings", async () => {
  const { manifest } = await fixture();
  const map = { ...record("replace"), fingerprint: manifest.map.fingerprint };
  await saveMap(map);
  const state = defaultNavigation(map.id);
  state.dimming = 0.3;
  state.markers = [
    { id: "mine", point: { x: 1, y: 1 }, label: "Mine", note: "", kind: "landmark", created: 1 },
    { id: "theirs-edited", point: { x: 2, y: 2 }, label: "Edited", note: "", kind: "landmark", created: 1 },
  ];
  state.routes = [
    { id: "done", name: "Done", points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], draft: false, created: 1 },
    { id: "drawing", name: "Drawing", points: [{ x: 1, y: 1 }], draft: true, created: 1 },
  ];
  state.importedItems = ["marker:theirs-edited", "marker:deleted-earlier"];
  await saveNavigation(state);
  assert.deepEqual(await importAnnotations(map.id, manifest, "replace"), { added: 2, skipped: 0, removed: 3 });
  const saved = await loadNavigation(map.id);
  assert.deepEqual(saved.markers, manifest.markers);
  assert.deepEqual(saved.routes.map((route) => route.id), ["drawing", ...manifest.routes.map((route) => route.id)]);
  assert.deepEqual(saved.importedItems, [...manifest.markers.map((item) => `marker:${item.id}`), ...manifest.routes.map((item) => `route:${item.id}`)]);
  assert.equal(saved.dimming, 0.3);
  assert.deepEqual(await importAnnotations(map.id, manifest), { added: 0, skipped: 2, removed: 0 }, "a later merge skips replaced items");
  // A queued save from an older window must not resurrect the removed annotations.
  state.dimming = 0.6;
  await saveNavigation(state);
  const afterStaleSave = await loadNavigation(map.id);
  assert.deepEqual(afterStaleSave.markers, manifest.markers);
  assert.deepEqual(afterStaleSave.routes, saved.routes);
  assert.deepEqual(afterStaleSave.importedItems, saved.importedItems);
  assert.equal(afterStaleSave.annotationRevision, 1);
  assert.equal(afterStaleSave.dimming, 0.6);
  const refreshed = preserveUnseenImports(state, afterStaleSave);
  refreshed.markers[0]!.note = "Edited after replacement";
  await saveNavigation(refreshed);
  assert.equal((await loadNavigation(map.id)).markers[0]!.note, "Edited after replacement", "edits after refreshing still persist");
  const later = { ...manifest, markers: [{ ...manifest.markers[0]!, id: "next-share" }], routes: [] };
  await importAnnotations(map.id, later, "replace");
  await saveNavigation(refreshed);
  assert.deepEqual((await loadNavigation(map.id)).markers, later.markers, "each replacement invalidates earlier snapshots");
});

test("new-copy import verifies images first and rolls back failed annotation commits", async () => {
  const { original, manifest } = await fixture();
  let calls = 0;
  const create = async () => {
    calls++;
    const map = record("copy");
    await saveMap(map);
    await payloadStore(map.backend).put(map.id, "original", original);
    return map;
  };
  const signal = new AbortController().signal;
  await assert.rejects(importNewCopy({ manifest }, image(512, 256, "different"), () => {}, signal, create), /does not match/);
  await assert.rejects(importNewCopy({ manifest }, image(1024, 256), () => {}, signal, create), /dimensions/);
  assert.equal(calls, 0);
  const imported = await importNewCopy({ manifest }, original, () => {}, signal, create);
  assert.equal(imported.added, 2);
  assert.equal((await loadNavigation(imported.map.id)).routes.length, 1);
  const db = await database();
  const transaction = db.transaction.bind(db);
  db.transaction = (...args: Parameters<IDBDatabase["transaction"]>) => {
    if (Array.isArray(args[0]) && args[0].includes("navigation"))
      throw new DOMException("Device storage full", "QuotaExceededError");
    return transaction(...args);
  };
  try {
    await assert.rejects(importNewCopy({ manifest }, original, () => {}, signal, async () => {
      const map = record("failed-copy");
      await saveMap(map);
      await payloadStore(map.backend).put(map.id, "original", original);
      return map;
    }), /Device storage full/);
  } finally { db.transaction = transaction; }
  assert.equal((await listMaps()).some((map) => map.id === "failed-copy"), false);
  await assert.rejects(payloadStore("indexeddb").get("failed-copy", "original"));
});

test("cancelling an active annotation transaction leaves the destination unchanged", async () => {
  const { manifest } = await fixture();
  const map = { ...record("cancelled"), fingerprint: manifest.map.fingerprint };
  await saveMap(map);
  const state = defaultNavigation(map.id);
  await saveNavigation(state);
  let controller = new AbortController();
  const db = await database();
  const transaction = db.transaction.bind(db);
  db.transaction = (...args: Parameters<IDBDatabase["transaction"]>) => {
    const tx = transaction(...args);
    if (Array.isArray(args[0]) && args[0].includes("navigation"))
      queueMicrotask(() => controller.abort());
    return tx;
  };
  try {
    for (const mode of ["merge", "replace"] as const) {
      controller = new AbortController();
      await assert.rejects(importAnnotations(map.id, manifest, mode, controller.signal), { name: "AbortError" });
    }
  } finally { db.transaction = transaction; }
  assert.deepEqual(await loadNavigation(map.id), state);
});
