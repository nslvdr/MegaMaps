import type { ImportProgress, MapRecord } from "../types";
import { database } from "../storage/database";
import { payloadStore, deleteStoredMap } from "../storage/payloads";
import { defaultNavigation, normalizeNavigation, type NavigationState } from "../viewer/navigation";
import { importMap } from "../processing/import";
import { readHeader } from "../processing/headers";
import { mergeAnnotations } from "./annotations";
import { fingerprint, encodeShare, shareFilename, verifyImage, type SharedMap, type ShareManifest } from "./format";

/** Cache on the latest record so hashing cannot undo a concurrent rename/deletion. */
async function cacheFingerprint(id: string, fingerprint: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("maps", "readwrite");
    const store = tx.objectStore("maps");
    const request: IDBRequest<MapRecord | undefined> = store.get(id);
    request.onsuccess = () => {
      if (request.result?.status === "ready") store.put({ ...request.result, fingerprint });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
export async function mapFingerprint(map: MapRecord, signal?: AbortSignal) {
  if (map.fingerprint) return map.fingerprint;
  const original = await payloadStore(map.backend).get(map.id, "original");
  const hash = await fingerprint(original, signal);
  await cacheFingerprint(map.id, hash);
  return hash;
}

/** Renamed files still match; equally sized maps never match without hashing. */
export async function matchingMaps(manifest: ShareManifest, maps: MapRecord[], signal?: AbortSignal) {
  const matches: string[] = [];
  for (const map of maps) {
    signal?.throwIfAborted();
    if (map.width !== manifest.map.width || map.height !== manifest.map.height) continue;
    try {
      if (await mapFingerprint(map, signal) === manifest.map.fingerprint) matches.push(map.id);
    } catch (error) {
      signal?.throwIfAborted();
      // An unavailable original cannot be declared an exact match.
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  return matches;
}

export async function prepareExport(map: MapRecord, state: NavigationState) {
  const original = await payloadStore(map.backend).get(map.id, "original");
  const header = await readHeader(original);
  const hash = await mapFingerprint(map);
  const extension = header.format === "jpeg" ? "jpg" : header.format;
  const image = { name: `map.${extension}`, type: `image/${header.format}`, bytes: original.size };
  return {
    map: { name: map.name, width: map.width, height: map.height, fingerprint: hash },
    markers: structuredClone(state.markers),
    routes: structuredClone(state.routes.filter((route) => !route.draft && route.points.length >= 2)),
    image, original,
  };
}
export type PreparedExport = Awaited<ReturnType<typeof prepareExport>>;
export interface ShareSelection { markers: string[]; routes: string[]; includeImage: boolean }
export function exportFile(prepared: PreparedExport, selection: ShareSelection) {
  const markers = new Set(selection.markers), routes = new Set(selection.routes);
  const manifest: ShareManifest = { format: "megamap", version: 1, map: prepared.map,
    markers: prepared.markers.filter((item) => markers.has(item.id)),
    routes: prepared.routes.filter((item) => routes.has(item.id)),
    ...(selection.includeImage ? { image: prepared.image } : {}) };
  return new File([encodeShare(manifest, selection.includeImage ? prepared.original : undefined)],
    shareFilename(prepared.map.name), { type: "application/octet-stream" });
}

/** Read and merge in a single transaction; concurrent imports cannot lose each other. */
export async function importAnnotations(mapId: string, manifest: ShareManifest, allowDifferentImage = false, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const db = await database();
  signal?.throwIfAborted();
  return new Promise<{ added: number; skipped: number }>((resolve, reject) => {
    const tx = db.transaction(["maps", "navigation"], "readwrite");
    const abort = () => tx.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const finish = () => signal?.removeEventListener("abort", abort);
    const maps = tx.objectStore("maps"), navigation = tx.objectStore("navigation");
    const mapRequest: IDBRequest<MapRecord | undefined> = maps.get(mapId);
    const stateRequest: IDBRequest<NavigationState | undefined> = navigation.get(mapId);
    let result = { added: 0, skipped: 0 };
    let failure: Error | undefined;
    stateRequest.onsuccess = () => {
      const map = mapRequest.result;
      if (!map || map.status !== "ready") failure = new Error("This map is no longer available.");
      else if (map.width !== manifest.map.width || map.height !== manifest.map.height)
        failure = new Error("Choose a map with the same dimensions as the shared map.");
      else if (!allowDifferentImage && map.fingerprint !== manifest.map.fingerprint)
        failure = new Error("Confirm annotation alignment before using a different map image.");
      if (failure) { tx.abort(); return; }
      const merged = mergeAnnotations(stateRequest.result ? normalizeNavigation(stateRequest.result) : defaultNavigation(mapId), manifest);
      result = { added: merged.added, skipped: merged.skipped };
      navigation.put(merged.state);
    };
    tx.oncomplete = () => { finish(); resolve(result); };
    tx.onabort = () => {
      finish();
      reject(signal?.aborted ? signal.reason : failure ?? tx.error ?? new Error("Could not import annotations."));
    };
    // Request errors also bubble here before tx.error is final. Reject on abort.
  });
}

/** A failed annotation commit rolls back only the new copy, never an existing map. */
export async function importNewCopy(
  share: SharedMap, image: File, onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal, create = importMap,
) {
  onProgress({ fraction: 0, message: "Checking map image…" });
  await verifyImage(image, share.manifest, signal);
  let map: MapRecord | undefined;
  try {
    signal.throwIfAborted();
    map = await create(new File([image], share.manifest.map.name, { type: image.type }), onProgress, signal);
    signal.throwIfAborted();
    await cacheFingerprint(map.id, share.manifest.map.fingerprint);
    signal.throwIfAborted();
    const result = await importAnnotations(map.id, share.manifest, false, signal);
    return { map, ...result };
  } catch (error) {
    if (map) await deleteStoredMap(map).catch(() => {});
    throw error;
  }
}
