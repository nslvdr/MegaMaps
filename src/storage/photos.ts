import { database, inMemory, transact } from "./database";
import type { NavigationState } from "../viewer/navigation";

export interface StoredPhoto {
  blob: Blob;
  created: number;
}
const key = (mapId: string, id: string) => `${mapId}/${id}`;
const range = (mapId: string) => IDBKeyRange.bound(`${mapId}/`, `${mapId}/￿`);
/** Unsaved form photos and other windows' edits get this long before pruning. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function savePhoto(mapId: string, blob: Blob) {
  const id = crypto.randomUUID();
  await transact("photos", "readwrite", (s) => s.put({ blob, created: Date.now() } satisfies StoredPhoto, key(mapId, id)));
  return id;
}

export async function loadPhoto(mapId: string, id: string) {
  return (await transact<StoredPhoto | undefined>("photos", "readonly", (s) => s.get(key(mapId, id))))?.blob;
}

/** Missing photos are left out rather than failing the whole set. */
export async function loadPhotos(mapId: string, ids: string[]) {
  const photos = new Map<string, Blob>();
  for (const id of new Set(ids)) {
    const blob = await loadPhoto(mapId, id);
    if (blob) photos.set(id, blob);
  }
  return photos;
}

/** Imported photos are slices of the picked file; Safari only stores them once copied. */
export async function copyPhotos(photos: Map<string, Blob>) {
  const copies = new Map<string, Blob>();
  for (const [id, blob] of photos) copies.set(id, await inMemory(blob));
  return copies;
}

/** Write shared photos within an annotation import so both land or neither does. */
export function putPhotos(tx: IDBTransaction, mapId: string, photos: Map<string, Blob>) {
  const store = tx.objectStore("photos"), created = Date.now();
  for (const [id, blob] of photos) store.put({ blob, created } satisfies StoredPhoto, key(mapId, id));
}

export const deleteMapPhotos = (mapId: string) =>
  transact("photos", "readwrite", (s) => s.delete(range(mapId)));

/** Removed photos, deleted places or routes and abandoned forms leave blobs nothing refers to. */
export async function prunePhotos(mapId: string, now = Date.now()) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["navigation", "photos"], "readwrite");
    const state: IDBRequest<NavigationState | undefined> = tx.objectStore("navigation").get(mapId);
    state.onsuccess = () => {
      const used = new Set([...state.result?.markers ?? [], ...state.result?.routes ?? []]
        .flatMap((item) => item.photos ?? []));
      const cursor = tx.objectStore("photos").openCursor(range(mapId));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const id = String(entry.key).slice(mapId.length + 1);
        if (!used.has(id) && now - (entry.value as StoredPhoto).created > PRUNE_AFTER_MS) entry.delete();
        entry.continue();
      };
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
