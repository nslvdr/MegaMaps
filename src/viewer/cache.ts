import { tileKey } from "../types";
import type { PayloadStore } from "../storage/payloads";
export interface TileRequest {
  level: number;
  x: number;
  y: number;
}
interface Entry extends TileRequest {
  bitmap: ImageBitmap;
  bytes: number;
  used: number;
}
export const TILE_CACHE_BUDGET = 24 * 1024 * 1024;
// Two decodes in flight and an explicit byte budget. Invisible requests are replaced
// on every camera change; a fling cannot build an unbounded loading queue.
export class TileCache {
  private entries = new Map<string, Entry>();
  private pending = new Set<string>();
  private wanted = new Set<string>();
  private queue: TileRequest[] = [];
  private failed = new Set<string>();
  private bytes = 0;
  private active = 0;
  private disposed = false;
  constructor(
    private store: PayloadStore,
    private mapId: string,
    private invalidate: () => void,
    private onError: (message: string) => void,
  ) {}
  get decodedBytes() {
    return this.bytes;
  }
  get queued() {
    return this.queue.length;
  }
  get tiles() {
    return [...this.entries.values()];
  }
  /** Every planned tile is decoded, so nothing drawn beneath them shows. */
  get complete() {
    for (const key of this.wanted) if (!this.entries.has(key)) return false;
    return true;
  }
  plan(tiles: TileRequest[]) {
    this.wanted = new Set(tiles.map((t) => tileKey(t.level, t.x, t.y)));
    for (const key of this.wanted) {
      const entry = this.entries.get(key);
      if (entry) entry.used = performance.now();
    }
    this.queue = tiles.filter((t) => {
      const key = tileKey(t.level, t.x, t.y);
      return (
        !this.entries.has(key) &&
        !this.pending.has(key) &&
        !this.failed.has(key)
      );
    });
    this.pump();
  }
  private evict(incoming: number) {
    const candidates = [...this.entries].sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of candidates) {
      if (this.bytes + incoming <= TILE_CACHE_BUDGET) break;
      if (this.wanted.has(key)) continue;
      entry.bitmap.close();
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
    return this.bytes + incoming <= TILE_CACHE_BUDGET;
  }
  private pump() {
    if (this.disposed) return;
    while (this.active < 2 && this.queue.length) {
      const request = this.queue.shift()!,
        key = tileKey(request.level, request.x, request.y);
      this.active++;
      this.pending.add(key);
      void this.load(request, key);
    }
  }
  private async load(request: TileRequest, key: string) {
    try {
      const bitmap = await createImageBitmap(
        await this.store.get(this.mapId, key),
      );
      const bytes = bitmap.width * bitmap.height * 4;
      if (this.disposed || !this.wanted.has(key) || !this.evict(bytes))
        bitmap.close();
      else {
        this.entries.set(key, {
          ...request,
          bitmap,
          bytes,
          used: performance.now(),
        });
        this.bytes += bytes;
        this.invalidate();
      }
    } catch {
      if (!this.disposed && this.wanted.has(key)) {
        this.failed.add(key);
        this.onError(
          "A map tile could not be read. Reopen the map or reimport the original.",
        );
      }
    } finally {
      this.active--;
      this.pending.delete(key);
      this.pump();
    }
  }
  dispose() {
    this.disposed = true;
    this.queue = [];
    for (const entry of this.entries.values()) entry.bitmap.close();
    this.entries.clear();
    this.bytes = 0;
  }
}
