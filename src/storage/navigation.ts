import { database, transact } from "./database";
import {
  defaultNavigation,
  normalizeNavigation,
  type NavigationState,
} from "../viewer/navigation";
import type { MapRecord } from "../types";
import { preserveUnseenImports } from "../sharing/annotations";
export async function loadNavigation(mapId: string) {
  const stored = await transact<NavigationState | undefined>(
    "navigation",
    "readonly",
    (s) => s.get(mapId),
  );
  return stored ? normalizeNavigation(stored) : defaultNavigation(mapId);
}
export const lastMap = () =>
  transact<string | null | undefined>("settings", "readonly", (s) =>
    s.get("last-map"),
  );
export const setLastMap = (id: string | null) =>
  transact("settings", "readwrite", (s) => s.put(id, "last-map"));
// One transaction checks map existence and writes notes. A late camera save after
// deleting a map cannot resurrect annotations or orphan a navigation record.
export async function saveNavigation(state: NavigationState) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["maps", "navigation"], "readwrite");
    const request: IDBRequest<MapRecord | undefined> = tx
      .objectStore("maps")
      .get(state.mapId);
    request.onsuccess = () => {
      if (request.result?.status === "ready") {
        const navigation = tx.objectStore("navigation");
        const saved: IDBRequest<NavigationState | undefined> = navigation.get(state.mapId);
        saved.onsuccess = () => navigation.put(preserveUnseenImports(
          state, saved.result ? normalizeNavigation(saved.result) : undefined,
        ));
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
export const deleteNavigation = (mapId: string) =>
  transact("navigation", "readwrite", (s) => s.delete(mapId));
// Throttle camera writes, serialize them, and flush on visibility changes/home.
export class NavigationPersistence {
  private timer?: ReturnType<typeof setTimeout>;
  private chain = Promise.resolve();
  private dirty = false;
  constructor(
    private snapshot: () => NavigationState,
    private onError: (error: unknown) => void,
  ) {}
  changed() {
    this.dirty = true;
    this.timer ??= setTimeout(() => {
      void this.flush();
    }, 250);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.dirty) {
      const state = structuredClone(this.snapshot());
      this.dirty = false;
      this.chain = this.chain
        .then(() => saveNavigation(state))
        .catch((error) => {
          this.dirty = true;
          this.onError(error);
        });
    }
    return this.chain;
  }
  // An explicit reload must stop if the final navigation write failed.
  async flushForReload() {
    await this.flush();
    if (this.dirty)
      throw new Error("Your latest changes could not be saved. Free some device storage and try again.");
  }
}
