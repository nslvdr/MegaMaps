export const TILE_SIZE = 512;
/** Maps are kept at most this size; larger images are shrunk to fit. */
export const MAX_PIXELS = 600_000_000;
export const MAX_SIDE = 32_768;
/** The JPEG decoder's scratch files stay under 2 GB up to this size. */
export const MAX_SOURCE_PIXELS = 1_000_000_000;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const NATIVE_PIXEL_LIMIT = 16_000_000;
export type Backend = "opfs" | "indexeddb";
export interface Level {
  width: number;
  height: number;
  scale: number;
  cols: number;
  rows: number;
}
export interface MapRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  backend: Backend;
  levels: Level[];
  created: number;
  /** Last time the map was opened; the library lists recent maps first. */
  opened?: number;
  status: "importing" | "ready" | "deleting";
  importMs?: number;
  tileBytes?: number;
  decoder?: string;
  offlineVerifiedAt?: number;
  /** The original's size, when it was too large and the map was shrunk to fit. */
  shrunkFrom?: { width: number; height: number };
  /** SHA-256 of the original image, calculated lazily for sharing. */
  fingerprint?: string;
}
export interface ImageHeader {
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp";
  orientation: number;
  progressive?: boolean;
}
export interface ImportProgress {
  fraction: number;
  message: string;
}
export type WorkerReply =
  | { type: "progress"; progress: ImportProgress }
  | { type: "done"; record: MapRecord }
  | { type: "error"; message: string };
export const tileKey = (level: number, x: number, y: number) =>
  `${level}-${x}-${y}.png`;
