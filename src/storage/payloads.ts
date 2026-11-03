import type { Backend, MapRecord } from "../types";
import { listMaps, transact, removeRecord, saveMap } from "./database";
import { deleteNavigation } from "./navigation";
import { deleteOcr } from "./ocr";
import { deleteMapPhotos } from "./photos";
import { t } from "../i18n";
export interface PayloadStore {
  put(mapId: string, key: string, blob: Blob): Promise<void>;
  get(mapId: string, key: string): Promise<Blob>;
  deleteMap(mapId: string): Promise<void>;
}
async function mapsFolder(create: boolean) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("maps", { create });
}
/** Each map's folder, looked up once rather than for every tile. Another
 * context (a worker, a tab) may remove one, so a lookup that fails is redone. */
const folders = new Map<string, Promise<FileSystemDirectoryHandle>>();
function folder(id: string, create: boolean) {
  let found = folders.get(id);
  if (!found) {
    found = mapsFolder(create).then((maps) => maps.getDirectoryHandle(id, { create }));
    folders.set(id, found);
    const settled = found;
    settled.catch(() => {
      if (folders.get(id) === settled) folders.delete(id);
    });
  }
  return found;
}
const missing = (error: unknown) =>
  error instanceof DOMException && error.name === "NotFoundError";
/** Runs with the map's folder, again with a fresh one if the kept one went missing. */
async function inFolder<T>(id: string, create: boolean, run: (dir: FileSystemDirectoryHandle) => Promise<T>) {
  const kept = folders.get(id);
  try {
    return await run(await folder(id, create));
  } catch (error) {
    if (!kept || !missing(error)) throw error;
    if (folders.get(id) === kept) folders.delete(id);
    return run(await folder(id, create));
  }
}
class OPFSStore implements PayloadStore {
  async put(id: string, key: string, blob: Blob) {
    const file = await inFolder(id, true, (dir) => dir.getFileHandle(key, { create: true }));
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
    return inFolder(id, false, async (dir) => (await dir.getFileHandle(key)).getFile());
  }
  async deleteMap(id: string) {
    folders.delete(id);
    try {
      await (await mapsFolder(true)).removeEntry(id, { recursive: true });
    } catch (error) {
      if (!missing(error)) throw error;
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
    if (!blob) throw new Error(t("A stored tile is missing. Reimport this map."));
    return blob;
  }
  // One range delete, instead of a cursor visiting each of a big map's tiles.
  async deleteMap(id: string) {
    await transact("payloads", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/\uffff`)));
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
  await deleteMapPhotos(map.id);
  await removeRecord(map.id);
}

/** Reset's Delete all data: every map with what it holds, then the stored settings. */
export async function deleteAllData() {
  for (const map of await listMaps()) await deleteStoredMap(map);
  await transact("settings", "readwrite", (store) => store.clear());
}
