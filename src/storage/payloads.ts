import type { Backend, MapRecord } from "../types";
import { database, transact, removeRecord, saveMap } from "./database";
import { deleteNavigation } from "./navigation";
import { deleteOcr } from "./ocr";
export interface PayloadStore {
  put(mapId: string, key: string, blob: Blob): Promise<void>;
  get(mapId: string, key: string): Promise<Blob>;
  deleteMap(mapId: string): Promise<void>;
}
async function directory(id?: string) {
  const root = await navigator.storage.getDirectory();
  const maps = await root.getDirectoryHandle("maps", { create: true });
  return id ? maps.getDirectoryHandle(id, { create: true }) : maps;
}
class OPFSStore implements PayloadStore {
  async put(id: string, key: string, blob: Blob) {
    const file = await (
      await directory(id)
    ).getFileHandle(key, { create: true });
    const writer = await file.createWritable();
    try {
      await writer.write(blob);
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }
  async get(id: string, key: string) {
    const root = await navigator.storage.getDirectory();
    const maps = await root.getDirectoryHandle("maps");
    return (
      await (await maps.getDirectoryHandle(id)).getFileHandle(key)
    ).getFile();
  }
  async deleteMap(id: string) {
    try {
      await (await directory()).removeEntry(id, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError"))
        throw error;
    }
  }
}
class IndexedDBStore implements PayloadStore {
  async put(id: string, key: string, blob: Blob) {
    await transact("payloads", "readwrite", (s) => s.put(blob, `${id}/${key}`));
  }
  async get(id: string, key: string) {
    const blob = await transact<Blob | undefined>("payloads", "readonly", (s) =>
      s.get(`${id}/${key}`),
    );
    if (!blob) throw new Error("A stored tile is missing. Reimport this map.");
    return blob;
  }
  async deleteMap(id: string) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("payloads", "readwrite");
      const request = tx
        .objectStore("payloads")
        .openKeyCursor(IDBKeyRange.bound(`${id}/`, `${id}/\uffff`));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          tx.objectStore("payloads").delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  }
}
const stores = { opfs: new OPFSStore(), indexeddb: new IndexedDBStore() };
export const payloadStore = (backend: Backend): PayloadStore => stores[backend];
export async function chooseBackend(): Promise<Backend> {
  if (navigator.storage && "getDirectory" in navigator.storage) {
    try {
      await stores.opfs.put("probe", "test", new Blob(["ok"]));
      await stores.opfs.deleteMap("probe");
      return "opfs";
    } catch {
      /* Sandboxed/private contexts may expose OPFS but disallow writes. */
    }
  }
  return "indexeddb";
}
// Tombstones make interrupted imports/deletions recoverable on the next launch.
export async function deleteStoredMap(map: MapRecord) {
  await saveMap({ ...map, status: "deleting" });
  await payloadStore(map.backend).deleteMap(map.id);
  await deleteNavigation(map.id);
  await deleteOcr(map.id);
  await removeRecord(map.id);
}
