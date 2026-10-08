import type { MapRecord } from "../types";
let opening: Promise<IDBDatabase> | undefined;
export function database() {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    // Keep the original database name so existing Mega Maps libraries stay accessible.
    const request = indexedDB.open("map-viewer", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("maps"))
        db.createObjectStore("maps", { keyPath: "id" });
      if (!db.objectStoreNames.contains("payloads"))
        db.createObjectStore("payloads");
      if (!db.objectStoreNames.contains("navigation"))
        db.createObjectStore("navigation", { keyPath: "mapId" });
      if (!db.objectStoreNames.contains("settings"))
        db.createObjectStore("settings");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = undefined;
      };
      request.result.onclose = () => {
        opening = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      opening = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      opening = undefined;
      reject(new Error("Close other Mega Maps tabs to update local storage."));
    };
  }));
}
// Resolve on transaction commit, not request success: quota errors can arrive later.
export async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () =>
      reject(
        tx.error ?? request.error ?? new Error("Storage transaction aborted."),
      );
    tx.onerror = () => reject(tx.error ?? request.error);
  });
}
export const saveMap = (map: MapRecord) =>
  transact("maps", "readwrite", (s) => s.put(map));
export const listMaps = () =>
  transact<MapRecord[]>("maps", "readonly", (s) => s.getAll());
// Update only the name on the latest record, without restoring a removed map.
export async function renameMap(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a map name.");
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("maps", "readwrite");
    const store = tx.objectStore("maps");
    const request: IDBRequest<MapRecord | undefined> = store.get(id);
    let missing = false;
    request.onsuccess = () => {
      const map = request.result;
      if (!map || map.status !== "ready") {
        missing = true;
        tx.abort();
        return;
      }
      store.put({ ...map, name: trimmed });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(missing
      ? new Error("This map is no longer available.")
      : tx.error ?? new Error("Could not save the map name."));
  });
}
export const removeRecord = (id: string) =>
  transact("maps", "readwrite", (s) => s.delete(id));
