import { worldToScreen, type Camera, type Size } from "./camera";
import { darken } from "./appearance";
import { STREET_TILE_SIZE, streetTiles } from "./geo";
import type { StreetColor } from "./navigation";

/** How strongly the streets show beside the map while matching spots. */
export const STREETS_STRENGTH = 0.55;
/** How the streets are drawn: in dark mode or not, in one colour or OSM's own. */
export interface StreetStyle {
  dark: boolean;
  color: StreetColor;
}
/** Each colour twice: deep enough to read multiplied onto paper, bright enough to glow screened onto black. */
const tints: Record<Exclude<StreetColor, "osm">, { light: RGB; dark: RGB }> = {
  pink: { light: [200, 30, 150], dark: [255, 79, 216] },
  violet: { light: [110, 60, 220], dark: [160, 130, 255] },
  grey: { light: [70, 70, 70], dark: [200, 200, 200] },
};
type RGB = [number, number, number];
/** What a colour looks like in the View panel, which is always dark. */
export const streetSwatch = (color: StreetColor) =>
  color === "osm" ? "linear-gradient(135deg, #f2efe9 50%, #aad3df 50%)" : `rgb(${tints[color].dark.join(" ")})`;
/** OSM's background and landuse are lighter than this, and drop out of a coloured street tile. */
const PAPER = 0.9;
/** How much darker than PAPER a pixel must be to take the full colour. */
const INK_SPAN = 0.3;

/** Recolours a street tile's pixels in place. Coloured, OSM's light fills drop
 * out and what's darker (buildings, outlines, names) takes the colour as
 * strongly as it's dark: white beneath for light maps, black for dark ones. */
export function recolour(rgba: Uint8ClampedArray, { dark, color }: StreetStyle) {
  if (color === "osm") {
    if (dark) darken(rgba, { invert: true, contrast: 1, brightness: 1 });
    return;
  }
  const [r, g, b] = tints[color][dark ? "dark" : "light"];
  for (let i = 0; i < rgba.length; i += 4) {
    const lightness = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) / 255,
      ink = Math.min(1, Math.max(0, (PAPER - lightness) / INK_SPAN));
    rgba[i] = dark ? r * ink : 255 - (255 - r) * ink;
    rgba[i + 1] = dark ? g * ink : 255 - (255 - g) * ink;
    rgba[i + 2] = dark ? b * ink : 255 - (255 - b) * ink;
  }
}

/** Streets are at full strength zoomed out to find your way, at street level
 * (z17) and beyond, and fade to a quarter zoomed in to read galleries (z20). */
const FADE_FROM = 0.8, FADE_TO = 0.1, FADED = 0.25;
/** How much of their strength the streets keep at this many metres per screen pixel. */
export function streetFade(metresPerPixel: number) {
  const t = Math.log(FADE_FROM / metresPerPixel) / Math.log(FADE_FROM / FADE_TO);
  return 1 - (1 - FADED) * Math.min(1, Math.max(0, t));
}
const tileURL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
/** Decoded street tiles kept for panning back: about 60 MB. */
const MOST_KEPT = 240;
/** Downloads at once; the rest are asked for again as these land. */
const MOST_LOADING = 8;
/** A tile that failed, offline say, is tried again after this long. */
const RETRY_MS = 10_000;
/** How many zooms up a loaded tile fills in, enlarged, while a sharper one loads. */
const FALLBACK_ZOOMS = 5;
const styleKey = ({ dark, color }: StreetStyle) => `${color}${dark ? " dark" : ""}`;
interface Entry {
  bitmap?: ImageBitmap;
  /** The tile recoloured for a style, made the first time it's drawn that way. */
  look?: { key: string; bitmap: ImageBitmap };
  /** The style being made, the latest asked for. */
  styling?: string;
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
  draw(ctx: CanvasRenderingContext2D, view: Camera, viewport: Size, dpr: number, style: StreetStyle) {
    const { z, tiles } = streetTiles(view, viewport),
      n = 2 ** z,
      now = performance.now(),
      k = view.scale / n / STREET_TILE_SIZE,
      c = Math.cos(view.rotation ?? 0) * k * dpr,
      s = Math.sin(view.rotation ?? 0) * k * dpr;
    for (const { x, y } of tiles) {
      this.want(z, x, y, now);
      // Until it loads, the nearest loaded tile above it fills in, enlarged.
      const image = (entry?: Entry) => entry && this.styled(entry, style);
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
  /** The tile in this style. Recoloured pixel by pixel, as the map is,
   * because Safari ignores canvas filters. Until a new style is made, the
   * last one still shows, so changing colour never blanks the streets. */
  private styled(entry: Entry, style: StreetStyle) {
    if (!entry.bitmap) return undefined;
    if (style.color === "osm" && !style.dark) return entry.bitmap;
    const key = styleKey(style);
    if (entry.look?.key === key || entry.styling === key) return entry.look?.bitmap;
    entry.styling = key;
    const { width, height } = entry.bitmap,
      ctx = new OffscreenCanvas(width, height).getContext("2d")!;
    ctx.drawImage(entry.bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    recolour(pixels.data, style);
    void createImageBitmap(pixels).then((bitmap) => {
      // A tile evicted, or restyled again meanwhile, keeps what it has.
      if (!entry.bitmap || entry.styling !== key) return bitmap.close();
      entry.look?.bitmap.close();
      entry.look = { key, bitmap };
      if (!this.controller.signal.aborted) this.onLoad();
    }).catch(() => {}).finally(() => {
      if (entry.styling === key) entry.styling = undefined;
    });
    return entry.look?.bitmap;
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
      entry.look?.bitmap.close();
      entry.look = undefined;
      entry.bitmap = undefined;
      this.tiles.delete(id);
    }
  }
  dispose() {
    this.controller.abort();
    for (const entry of this.tiles.values()) {
      entry.bitmap?.close();
      entry.look?.bitmap.close();
      entry.look = undefined;
    }
    this.tiles.clear();
  }
}
