import { TILE_SIZE, tileKey, type ImageHeader, type Level } from "../types";
import type { PayloadStore } from "../storage/payloads";
import type { RowConsumer } from "./png";

// Only one full-width 512-row band exists: 17.6 MiB for a 9k map,
// rather than a 309 MiB RGBA image. It is reused for every tile row.
export function tileBand(
  header: ImageHeader,
  canvas: OffscreenCanvas,
  store: PayloadStore,
  id: string,
  progress: () => void,
) {
  const band = new Uint8ClampedArray(
    header.width * Math.min(TILE_SIZE, header.height) * 4,
  );
  const data = canvas.getContext("2d")!.createImageData(TILE_SIZE, TILE_SIZE);
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
      await store.put(
        id,
        tileKey(0, x / TILE_SIZE, tileY),
        await canvas.convertToBlob({ type: "image/png" }),
      );
      progress();
    }
  };
  return consume;
}
// Each level is drawn from the sharp PNG level below. A JPEG map then saves
// each zoomed-out level as JPEG once, after the next level has been drawn
// from it, so JPEG loss never adds up from level to level.
export async function buildParents(
  levels: Level[],
  canvas: OffscreenCanvas,
  store: PayloadStore,
  id: string,
  progress: () => void,
  type: "image/png" | "image/jpeg" = "image/png",
) {
  // Parents read one child at a time. No whole intermediate resolution is decoded.
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
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const cx = x * 2 + dx,
              cy = y * 2 + dy;
            if (cx >= childLevel.cols || cy >= childLevel.rows) continue;
            const bitmap = await createImageBitmap(
              await store.get(id, tileKey(index - 1, cx, cy)),
            );
            try {
              // Whole pixels: a half-covered edge pixel would turn half transparent.
              ctx.drawImage(
                bitmap,
                (dx * TILE_SIZE) / 2,
                (dy * TILE_SIZE) / 2,
                Math.ceil(bitmap.width / 2),
                Math.ceil(bitmap.height / 2),
              );
            } finally {
              bitmap.close();
            }
          }
        await store.put(
          id,
          tileKey(index, x, y),
          await canvas.convertToBlob({ type: "image/png" }),
        );
        progress();
      }
    if (type === "image/jpeg" && index > 1)
      await saveAsJPEG(levels[index - 1]!, index - 1, canvas, store, id);
  }
  if (type === "image/jpeg" && levels.length > 1)
    await saveAsJPEG(levels.at(-1)!, levels.length - 1, canvas, store, id);
}
async function saveAsJPEG(
  level: Level,
  index: number,
  canvas: OffscreenCanvas,
  store: PayloadStore,
  id: string,
) {
  for (let y = 0; y < level.rows; y++)
    for (let x = 0; x < level.cols; x++) {
      const key = tileKey(index, x, y),
        bitmap = await createImageBitmap(await store.get(id, key));
      try {
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }
      await store.put(
        id,
        key,
        await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 }),
      );
    }
}
