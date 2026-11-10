import { worldToScreen, type Camera, type Size } from "./camera";
import { darken } from "./appearance";
import { STREET_TILE_SIZE, streetTiles } from "./geo";

/** How strongly the streets show, from nothing (0) to full (1): the plan stays what you read. */
export const STREETS_STRENGTH = 0.55;
const tileURL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
/** Decoded street tiles kept for panning back: about 60 MB. */
const MOST_KEPT = 240;
/** Downloads at once; the rest are asked for again as these land. */
const MOST_LOADING = 8;
/** A tile that failed, offline say, is tried again after this long. */
const RETRY_MS = 10_000;
/** How many zooms up a loaded tile fills in, enlarged, while a sharper one loads. */
const FALLBACK_ZOOMS = 5;
interface Entry {
  bitmap?: ImageBitmap;
  /** The tile inverted, hues kept, made the first time dark streets need it. */
  dark?: ImageBitmap;
  darkening?: boolean;
  failed?: number;
  used: number;
}
const key = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** OpenStreetMap's streets, fetched as the screen needs them. Only tiles the
 * person looks at are downloaded, as the tile usage policy asks: none ahead. */
export class StreetTiles {
  private tiles = new Map<string, Entry>();
  private loading = 0;
  private controller = new AbortController();
  constructor(private onLoad: () => void) {}
  /** Paints the screen's tiles; `view` takes Mercator to screen pixels. */
  draw(ctx: CanvasRenderingContext2D, view: Camera, viewport: Size, dpr: number, dark: boolean) {
    const { z, tiles } = streetTiles(view, viewport),
      n = 2 ** z,
      now = performance.now(),
      k = view.scale / n / STREET_TILE_SIZE,
      c = Math.cos(view.rotation ?? 0) * k * dpr,
      s = Math.sin(view.rotation ?? 0) * k * dpr;
    for (const { x, y } of tiles) {
      this.want(z, x, y, now);
      // Until it loads, the nearest loaded tile above it fills in, enlarged.
      const image = (entry?: Entry) => (dark ? entry && this.darkened(entry) : entry?.bitmap);
      let depth = 0, entry = this.tiles.get(key(z, x, y));
      while (!image(entry) && depth < Math.min(z, FALLBACK_ZOOMS)) {
        depth++;
        entry = this.tiles.get(key(z - depth, x >> depth, y >> depth));
      }
      const bitmap = image(entry);
      if (!entry || !bitmap) continue;
      entry.used = now;
      const size = STREET_TILE_SIZE / 2 ** depth,
        origin = worldToScreen(view, { x: x / n, y: y / n });
      // Each tile is placed from its own corner, worked out in doubles: a
      // transform for the whole world would lose sub-pixel precision at street zooms.
      ctx.setTransform(c, s, -s, c, origin.x * dpr, origin.y * dpr);
      // Half a pixel over each edge hides the seams between neighbours.
      ctx.drawImage(bitmap, (x - ((x >> depth) << depth)) * size, (y - ((y >> depth) << depth)) * size,
        size, size, 0, 0, STREET_TILE_SIZE + 0.5, STREET_TILE_SIZE + 0.5);
    }
    this.evict();
  }
  /** The dark tile, once made. Recoloured pixel by pixel, as the map is,
   * because Safari ignores canvas filters. */
  private darkened(entry: Entry) {
    if (entry.dark || entry.darkening || !entry.bitmap) return entry.dark;
    entry.darkening = true;
    const { width, height } = entry.bitmap,
      ctx = new OffscreenCanvas(width, height).getContext("2d")!;
    ctx.drawImage(entry.bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    darken(pixels.data, { invert: true, contrast: 1, brightness: 1 });
    void createImageBitmap(pixels).then((dark) => {
      if (!entry.bitmap) return dark.close();
      entry.dark = dark;
      if (!this.controller.signal.aborted) this.onLoad();
    }).catch(() => {}).finally(() => {
      entry.darkening = false;
    });
  }
  private want(z: number, x: number, y: number, now: number) {
    const id = key(z, x, y), entry = this.tiles.get(id);
    if (entry) {
      entry.used = now;
      if (!entry.failed || now - entry.failed < RETRY_MS) return;
    }
    if (this.loading >= MOST_LOADING) return;
    const loading: Entry = { used: now };
    this.tiles.set(id, loading);
    this.loading++;
    fetch(tileURL(z, x, y), { signal: this.controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (this.tiles.get(id) !== loading) return bitmap.close();
        loading.bitmap = bitmap;
      })
      .catch(() => {
        loading.failed = performance.now();
      })
      .finally(() => {
        this.loading--;
        if (!this.controller.signal.aborted) this.onLoad();
      });
  }
  private evict() {
    if (this.tiles.size <= MOST_KEPT) return;
    const oldest = [...this.tiles].filter(([, entry]) => entry.bitmap || entry.failed)
      .sort(([, a], [, b]) => a.used - b.used)
      .slice(0, this.tiles.size - MOST_KEPT);
    for (const [id, entry] of oldest) {
      entry.bitmap?.close();
      entry.dark?.close();
      entry.bitmap = undefined;
      this.tiles.delete(id);
    }
  }
  dispose() {
    this.controller.abort();
    for (const entry of this.tiles.values()) {
      entry.bitmap?.close();
      entry.dark?.close();
    }
    this.tiles.clear();
  }
}
