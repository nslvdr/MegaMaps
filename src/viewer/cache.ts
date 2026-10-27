import { TILE_SIZE, tileKey } from "../types";
import type { PayloadStore } from "../storage/payloads";
import { t } from "../i18n";
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
// Safari reports no memory: assume 4 GB, as the OCR pool does.
const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) < 4;
export const TILE_CACHE_BUDGET = (lowMemory ? 24 : 56) * 1024 * 1024;
/** Decoded tiles a view may need at once; the budget keeps room for their parents. */
export const MOST_TILES = lowMemory ? 22 : 44;
/** A full tile decoded; edge tiles are smaller. */
const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;
// Two decodes in flight and an explicit byte budget. Invisible requests are replaced
// on every camera change; a fling cannot build an unbounded loading queue.
// While the screen loads, the parents of its missing tiles load first: a quarter
// as many, they fill it at half sharpness. Tiles just off screen load ahead, one
// at a time and only into room the screen leaves, so they never delay or push
// out what the screen shows.
export class TileCache {
  private entries = new Map<string, Entry>();
  private pending = new Set<string>();
  private wanted = new Set<string>();
  private queue: TileRequest[] = [];
  private failed = new Set<string>();
  private parents = new Set<string>();
  private ahead = new Set<string>();
  private aheadQueue: TileRequest[] = [];
  /** Kept apart so a tile that fails as a parent or ahead still loads, and reports, once on screen. */
  private aheadFailed = new Set<string>();
  private bytes = 0;
  private active = 0;
  private disposed = false;
  /** Bumped when the look changes, so earlier decodes are dropped. */
  private generation = 0;
  constructor(
    private store: PayloadStore,
    private mapId: string,
    private invalidate: () => void,
    private onError: (message: string) => void,
    private decode: (blob: Blob) => Promise<ImageBitmap> = (blob) => createImageBitmap(blob),
  ) {}
  get decodedBytes() {
    return this.bytes;
  }
  get queued() {
    return this.queue.length;
  }
  get loading() {
    return this.pending.size;
  }
  get tiles() {
    return [...this.entries.values()];
  }
  /** Every planned tile is decoded, so nothing drawn beneath them shows. */
  get complete() {
    for (const key of this.wanted) if (!this.entries.has(key)) return false;
    return true;
  }
  /** `around` lists tiles near the screen, nearest first; it is read only once
   * the screen is loading or done. Parents load only for levels below `overview`,
   * the level drawn whole beneath every tile. */
  plan(tiles: TileRequest[], around?: () => TileRequest[], overview = 0) {
    this.wanted = new Set(tiles.map((t) => tileKey(t.level, t.x, t.y)));
    this.parents = new Set();
    const parents: TileRequest[] = [];
    let room = TILE_CACHE_BUDGET;
    for (const key of this.wanted) room -= this.entries.get(key)?.bytes ?? TILE_BYTES;
    for (const t of tiles) {
      if (t.level + 1 >= overview || this.entries.has(tileKey(t.level, t.x, t.y))) continue;
      const parent = { level: t.level + 1, x: t.x >> 1, y: t.y >> 1 },
        key = tileKey(parent.level, parent.x, parent.y);
      if (this.parents.has(key)) continue;
      const bytes = this.entries.get(key)?.bytes ?? TILE_BYTES;
      if (bytes > room) break;
      room -= bytes;
      this.parents.add(key);
      if (!this.aheadFailed.has(key)) parents.push(parent);
    }
    for (const key of [...this.wanted, ...this.parents]) {
      const entry = this.entries.get(key);
      if (entry) entry.used = performance.now();
    }
    this.queue = [...parents, ...tiles].filter((t) => {
      const key = tileKey(t.level, t.x, t.y);
      return (
        !this.entries.has(key) &&
        !this.pending.has(key) &&
        !this.failed.has(key)
      );
    });
    this.ahead = new Set();
    this.aheadQueue = [];
    if (around && !this.queue.length) {
      let room = TILE_CACHE_BUDGET;
      for (const key of [...this.wanted, ...this.parents])
        room -= this.entries.get(key)?.bytes ?? (this.pending.has(key) ? TILE_BYTES : 0);
      for (const t of around()) {
        const key = tileKey(t.level, t.x, t.y);
        if (this.wanted.has(key)) continue;
        const bytes = this.entries.get(key)?.bytes ?? TILE_BYTES;
        if (bytes > room) break;
        room -= bytes;
        this.ahead.add(key);
        if (!this.entries.has(key) && !this.pending.has(key) && !this.failed.has(key) && !this.aheadFailed.has(key))
          this.aheadQueue.push(t);
      }
    }
    this.pump();
  }
  private evict(incoming: number) {
    const candidates = [...this.entries].sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of candidates) {
      if (this.bytes + incoming <= TILE_CACHE_BUDGET) break;
      if (this.wanted.has(key) || this.parents.has(key) || this.ahead.has(key)) continue;
      entry.bitmap.close();
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
    return this.bytes + incoming <= TILE_CACHE_BUDGET;
  }
  private pump() {
    if (this.disposed) return;
    const start = (request: TileRequest) => {
      const key = tileKey(request.level, request.x, request.y);
      this.active++;
      this.pending.add(key);
      void this.load(request, key);
    };
    while (this.active < 2 && this.queue.length) start(this.queue.shift()!);
    // A slot always stays free for the screen.
    if (!this.active && this.aheadQueue.length) start(this.aheadQueue.shift()!);
  }
  /** Drops every tile so the next plan decodes them again, in a new look. */
  reset() {
    this.generation++;
    this.queue = [];
    this.aheadQueue = [];
    this.pending.clear();
    this.failed.clear();
    this.aheadFailed.clear();
    for (const entry of this.entries.values()) entry.bitmap.close();
    this.entries.clear();
    this.bytes = 0;
  }
  private async load(request: TileRequest, key: string) {
    const generation = this.generation;
    try {
      const bitmap = await this.decode(await this.store.get(this.mapId, key));
      const bytes = bitmap.width * bitmap.height * 4;
      const shown = this.wanted.has(key) || this.parents.has(key);
      // A tile the camera has moved past stays while there is free room: drawn
      // beneath, it softens the next change of level.
      if (this.disposed || generation !== this.generation ||
          !(shown || this.ahead.has(key) ? this.evict(bytes) : this.bytes + bytes <= TILE_CACHE_BUDGET))
        bitmap.close();
      else {
        this.entries.set(key, {
          ...request,
          bitmap,
          bytes,
          used: performance.now(),
        });
        this.bytes += bytes;
        // Off screen, it waits to be drawn without a repaint.
        if (shown) this.invalidate();
      }
    } catch {
      if (this.disposed || generation !== this.generation) return;
      if (this.wanted.has(key)) {
        this.failed.add(key);
        this.onError(
          t("A map tile could not be read. Reopen the map or reimport the original."),
        );
      } else if (this.parents.has(key) || this.ahead.has(key)) this.aheadFailed.add(key);
    } finally {
      this.active--;
      if (generation === this.generation) this.pending.delete(key);
      this.pump();
    }
  }
  dispose() {
    this.disposed = true;
    this.queue = [];
    this.aheadQueue = [];
    for (const entry of this.entries.values()) entry.bitmap.close();
    this.entries.clear();
    this.bytes = 0;
  }
}
