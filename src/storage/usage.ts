import { database } from "./database";

// The browser's estimate is rounded and lags behind imports and deletions
// (Safari's most of all), so Settings adds up what the library actually holds.

async function folderBytes(folder: FileSystemDirectoryHandle): Promise<number> {
  let total = 0;
  for await (const entry of folder.values())
    total += entry.kind === "file" ? (await (entry as FileSystemFileHandle).getFile()).size
      : await folderBytes(entry as FileSystemDirectoryHandle);
  return total;
}

async function opfsBytes() {
  if (!navigator.storage || !("getDirectory" in navigator.storage)) return 0;
  try {
    return await folderBytes(await (await navigator.storage.getDirectory()).getDirectoryHandle("maps"));
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return 0;
    throw error;
  }
}

/** Tiles and originals kept in IndexedDB are blobs; photos are records holding one. */
async function indexedDBBytes() {
  const db = await database();
  return new Promise<number>((resolve, reject) => {
    let total = 0;
    const tx = db.transaction(["payloads", "photos"], "readonly");
    for (const name of ["payloads", "photos"]) {
      const cursor = tx.objectStore(name).openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const value = entry.value as Blob | { blob?: Blob };
        total += (value instanceof Blob ? value : value.blob)?.size ?? 0;
        entry.continue();
      };
    }
    tx.oncomplete = () => resolve(total);
    tx.onabort = () => reject(tx.error);
  });
}

/** Bytes taken by maps and photos on this device. */
export async function storedBytes() {
  const [files, records] = await Promise.all([opfsBytes(), indexedDBBytes()]);
  return files + records;
}
