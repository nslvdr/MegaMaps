import { database } from "./database";

// The browser's estimate is rounded and lags behind imports and deletions
// (Safari's most of all), so Settings adds up what the library actually holds.

async function folderBytes(folder: FileSystemDirectoryHandle): Promise<number> {
  // A map folder holds thousands of tiles; their sizes are read together, not one by one.
  const sizes: Promise<number>[] = [];
  for await (const entry of folder.values())
    sizes.push(entry.kind === "file" ? (entry as FileSystemFileHandle).getFile().then((file) => file.size)
      : folderBytes(entry as FileSystemDirectoryHandle));
  return (await Promise.all(sizes)).reduce((total, size) => total + size, 0);
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

/** Adds up one IndexedDB store: blobs as they are, records holding one by their blob,
 * and anything else, such as saved places and detected text, by its size as JSON. */
async function storeBytes(name: "payloads" | "photos" | "navigation" | "ocr") {
  const db = await database();
  return new Promise<number>((resolve, reject) => {
    let total = 0;
    const tx = db.transaction(name, "readonly");
    const cursor = tx.objectStore(name).openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      const value: unknown = entry.value;
      const blob = value instanceof Blob ? value
        : typeof value === "object" && value !== null && "blob" in value && value.blob instanceof Blob ? value.blob : undefined;
      total += blob ? blob.size : JSON.stringify(value)?.length ?? 0;
      entry.continue();
    };
    tx.oncomplete = () => resolve(total);
    tx.onabort = () => reject(tx.error);
  });
}

/** What this device holds, by what it's for: map images and tiles, place photos, then places, routes and detected text. */
export async function storageUse() {
  const [files, payloads, photos, navigation, ocr] = await Promise.all([
    opfsBytes(), storeBytes("payloads"), storeBytes("photos"), storeBytes("navigation"), storeBytes("ocr"),
  ]);
  return { maps: files + payloads, photos, notes: navigation + ocr };
}

/** Bytes taken by maps, photos and notes on this device. */
export async function storedBytes() {
  const { maps, photos, notes } = await storageUse();
  return maps + photos + notes;
}
