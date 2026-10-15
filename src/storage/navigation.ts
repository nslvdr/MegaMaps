import { t } from "../i18n";
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
/** How long the camera must rest before its view is saved. */
export const VIEW_REST_MS = 2000;
// Edits save within 250 ms; the camera saves once it rests, since a compass
// turning the map would otherwise write several times a second. Writes are
// serialized, and visibility changes and going home flush them.
export class NavigationPersistence {
  private timer?: ReturnType<typeof setTimeout>;
  /** An edit's save is due soon; camera moves must not push it back. */
  private soon = false;
  private chain = Promise.resolve();
  private dirty = false;
  constructor(
    private snapshot: () => NavigationState,
    private onError: (error: unknown) => void,
  ) {}
  changed() {
    this.dirty = true;
    if (this.soon) return;
    this.soon = true;
    this.schedule(250);
  }
  moved() {
    this.dirty = true;
    if (!this.soon) this.schedule(VIEW_REST_MS);
  }
  private schedule(wait: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, wait);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.soon = false;
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
      throw new Error(t("Your latest changes could not be saved. Free some device storage and try again."));
  }
}
