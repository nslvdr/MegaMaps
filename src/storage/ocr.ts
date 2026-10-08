import type { MapRecord } from "../types";
import type { OcrIndex } from "../ocr/index";
import { database, transact } from "./database";

export const loadOcr = (mapId: string) =>
  transact<OcrIndex | undefined>("ocr", "readonly", (store) =>
    store.get(mapId),
  );
export const deleteOcr = (mapId: string) =>
  transact("ocr", "readwrite", (store) => store.delete(mapId));

// Keep the previous index until a full scan commits; never resurrect a deleted map.
export async function saveOcr(index: OcrIndex) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["maps", "ocr"], "readwrite");
    const request = tx.objectStore("maps").get(index.mapId);
    request.onsuccess = () => {
      const map = request.result as MapRecord | undefined;
      if (map?.status !== "ready") return tx.abort();
      tx.objectStore("ocr").put(index);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("Map is no longer available."));
    tx.onerror = () => reject(tx.error);
  });
}
