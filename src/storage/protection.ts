// Without persistent storage, a browser may clear the whole library when the device runs low on space.

/** Whether the browser keeps the library under storage pressure; undefined when it can't say. */
export async function storageProtected() {
  return navigator.storage?.persisted?.().catch(() => undefined);
}

/** Ask the browser to keep the library. Chrome decides silently; Firefox may ask the user once. */
export async function protectStorage() {
  if (await storageProtected()) return true;
  return navigator.storage?.persist?.().catch(() => undefined);
}
