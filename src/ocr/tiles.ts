import { TILE_SIZE, tileKey, type MapRecord } from "../types";
import type { PayloadStore } from "../storage/payloads";

export const OCR_TILE_CACHE_BYTES = 4 * 1024 * 1024;
const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

// Scan-local LRU cache reuses overlap tiles and releases every bitmap on exit.
export class OcrTileCache {
  private tiles = new Map<string, ImageBitmap>();
  private bytes = 0;

  constructor(
    private map: MapRecord,
    private store: PayloadStore,
    private signal: AbortSignal,
  ) {}

  async get(x: number, y: number) {
    this.signal.throwIfAborted();
    const key = tileKey(0, x, y);
    const cached = this.tiles.get(key);
    if (cached) {
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }
    // Reserve one full tile before decoding, so the transient decode also fits.
    while (this.bytes + TILE_BYTES > OCR_TILE_CACHE_BYTES) {
      const oldest = this.tiles.entries().next().value!;
      this.tiles.delete(oldest[0]);
      this.bytes -= oldest[1].width * oldest[1].height * 4;
      oldest[1].close();
    }
    const payload = await this.store.get(this.map.id, key);
    this.signal.throwIfAborted();
    const bitmap = await createImageBitmap(payload);
    try {
      this.signal.throwIfAborted();
      if (bitmap.width > TILE_SIZE || bitmap.height > TILE_SIZE)
        throw new Error("Unexpected oversized map tile.");
      this.tiles.set(key, bitmap);
      this.bytes += bitmap.width * bitmap.height * 4;
      return bitmap;
    } catch (error) {
      bitmap.close();
      throw error;
    }
  }

  dispose() {
    for (const bitmap of this.tiles.values()) bitmap.close();
    this.tiles.clear();
    this.bytes = 0;
  }
}
