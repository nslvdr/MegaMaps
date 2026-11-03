import { TILE_SIZE, tileKey, type Level } from "../types";
import type { PayloadStore } from "../storage/payloads";
import type { RowConsumer } from "./png";

/** Tiles encoding and saving at once. Encoding copies the canvas when it
 * starts, so the next tile is drawn while earlier ones encode and save; a
 * few at a time keeps the copies small. */
const IN_FLIGHT = 4;
export function tileWriter(store: PayloadStore, id: string, progress: () => void) {
  const pending: Promise<void>[] = [];
  return {
    async write(canvas: OffscreenCanvas, key: string) {
      const saved = canvas.convertToBlob({ type: "image/png" })
        .then((blob) => store.put(id, key, blob))
        .then(progress);
      // Awaited in order below; this only keeps a failure from being reported twice.
      saved.catch(() => {});
      pending.push(saved);
      if (pending.length >= IN_FLIGHT) await pending.shift();
    },
    /** Every tile written so far is saved. */
    async flush() {
      while (pending.length) await pending.shift();
    },
  };
}
// Only one full-width 512-row band exists: 17.6 MiB for a 9k map,
// rather than a 309 MiB RGBA image. It is reused for every tile row.
export function tileBand(
  header: { width: number; height: number },
  canvas: OffscreenCanvas,
  store: PayloadStore,
  id: string,
  progress: () => void,
) {
  const band = new Uint8ClampedArray(
    header.width * Math.min(TILE_SIZE, header.height) * 4,
  );
  const data = canvas.getContext("2d")!.createImageData(TILE_SIZE, TILE_SIZE);
  const tiles = tileWriter(store, id, progress);
  const consume: RowConsumer = async (row, y) => {
    band.set(row, (y % TILE_SIZE) * header.width * 4);
    if (y % TILE_SIZE !== TILE_SIZE - 1 && y !== header.height - 1) return;
    const height = (y % TILE_SIZE) + 1,
      tileY = Math.floor(y / TILE_SIZE);
    for (let x = 0; x < header.width; x += TILE_SIZE) {
      const width = Math.min(TILE_SIZE, header.width - x);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      for (let rowY = 0; rowY < height; rowY++) {
        const start = (rowY * header.width + x) * 4;
        data.data.set(
          band.subarray(start, start + width * 4),
          rowY * TILE_SIZE * 4,
        );
      }
      ctx.putImageData(data, 0, 0, 0, 0, width, height);
      await tiles.write(canvas, tileKey(0, x / TILE_SIZE, tileY));
    }
    // The map's last row: every tile is saved before parents read them.
    if (y === header.height - 1) await tiles.flush();
  };
  return consume;
}
// Each level is drawn from the lossless PNG level below.
export async function buildParents(
  levels: Level[],
  canvas: OffscreenCanvas,
  store: PayloadStore,
  id: string,
  progress: () => void,
) {
  // Parents read one child at a time. No whole intermediate resolution is decoded.
  const tiles = tileWriter(store, id, progress);
  for (let index = 1; index < levels.length; index++) {
    const level = levels[index]!,
      childLevel = levels[index - 1]!;
    for (let y = 0; y < level.rows; y++)
      for (let x = 0; x < level.cols; x++) {
        const width = Math.min(TILE_SIZE, level.width - x * TILE_SIZE),
          height = Math.min(TILE_SIZE, level.height - y * TILE_SIZE);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, width, height);
        // The four children are read and decoded together, then drawn.
        const children = [[0, 0], [1, 0], [0, 1], [1, 1]]
          .filter(([dx, dy]) => x * 2 + dx! < childLevel.cols && y * 2 + dy! < childLevel.rows);
        const decoded = await Promise.allSettled(children.map(async ([dx, dy]) =>
          createImageBitmap(await store.get(id, tileKey(index - 1, x * 2 + dx!, y * 2 + dy!)))));
        try {
          for (const [i, result] of decoded.entries()) {
            if (result.status === "rejected") throw result.reason;
            const [dx, dy] = children[i]!, bitmap = result.value;
            // Whole pixels: a half-covered edge pixel would turn half transparent.
            ctx.drawImage(
              bitmap,
              (dx! * TILE_SIZE) / 2,
              (dy! * TILE_SIZE) / 2,
              Math.ceil(bitmap.width / 2),
              Math.ceil(bitmap.height / 2),
            );
          }
        } finally {
          for (const result of decoded) if (result.status === "fulfilled") result.value.close();
        }
        await tiles.write(canvas, tileKey(index, x, y));
      }
    // The next level is drawn from this one's saved tiles.
    await tiles.flush();
  }
}
