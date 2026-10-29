import { locale, t } from "../i18n";
import {
  NATIVE_PIXEL_LIMIT,
  TILE_SIZE,
  tileKey,
  type MapRecord,
  type WorkerReply,
} from "../types";
import { payloadStore } from "../storage/payloads";
import { inMemory, saveMap } from "../storage/database";
import { readHeader } from "./headers";
import { pyramid, tileCount } from "./pyramid";
import { decodePNG, NativePNGRequired } from "./png";
import { DECODED, decodeJPEG } from "./jpeg";
import { tileBand, buildParents } from "./tiles";
const reply = (message: WorkerReply) => postMessage(message);
// A failed promise nothing waits on would otherwise leave the import waiting forever.
onunhandledrejection = ({ reason }) =>
  reply({ type: "error", message: reason instanceof Error ? reason.message : String(reason) });
onmessage = async (event: MessageEvent<{ file: File; record: MapRecord }>) => {
  const { file, record } = event.data;
  const start = performance.now();
  try {
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined"
    )
      throw new Error(
        t("Mega Maps needs a modern browser with worker canvas support (iOS 17+ recommended)."),
      );
    const header = await readHeader(file);
    if (header.orientation !== 1)
      throw new Error(
        t("This JPEG has EXIF rotation. Export it with rotation applied to the pixels before importing."),
      );
    const levels = pyramid(header.width, header.height),
      total = tileCount(levels);
    const store = payloadStore(record.backend);
    let done = 0,
      last = 0;
    const tileSizes = new Map<string, number>();
    const measuredStore = {
      ...store,
      get: store.get.bind(store),
      deleteMap: store.deleteMap.bind(store),
      async put(id: string, key: string, blob: Blob) {
        tileSizes.set(key, blob.size);
        await store.put(id, key, blob);
      },
    };
    const progress = () => {
      done++;
      if (performance.now() - last > 80 || done === total) {
        last = performance.now();
        reply({
          type: "progress",
          progress: {
            fraction: 0.03 + (done / total) * 0.96,
            message: t("Preparing map · {done} / {total} tiles", { done: done.toLocaleString(locale), total: total.toLocaleString(locale) }),
          },
        });
      }
    };
    reply({
      type: "progress",
      progress: { fraction: 0.01, message: t("Saving original on this device…") },
    });
    // The picked file itself can't go into IndexedDB on Safari; OPFS writes it as is.
    await store.put(record.id, "original", record.backend === "indexeddb" ? await inMemory(file) : file);
    reply({
      type: "progress",
      progress: {
        fraction: 0.03,
        message: header.progressive
          ? t("Decoding progressive JPEG locally…")
          : t("Decoding image into tiles…"),
      },
    });
    const canvas = new OffscreenCanvas(1, 1);
    const consume = tileBand(
      header,
      canvas,
      measuredStore,
      record.id,
      progress,
    );
    let decoder = header.format === "jpeg" ? DECODED : "PNG streaming scanlines";
    async function native() {
      if (header.width * header.height > NATIVE_PIXEL_LIMIT)
        throw new Error(
          t("WebP and interlaced PNG are limited to 16 megapixels in this version. For larger maps use JPEG or non-interlaced PNG."),
        );
      decoder = "size-limited native bitmap";
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width !== header.width || bitmap.height !== header.height)
          throw new Error(t("Image metadata does not match decoded dimensions."));
        for (let y = 0; y < header.height; y += TILE_SIZE)
          for (let x = 0; x < header.width; x += TILE_SIZE) {
            canvas.width = Math.min(TILE_SIZE, header.width - x);
            canvas.height = Math.min(TILE_SIZE, header.height - y);
            canvas.getContext("2d")!.drawImage(bitmap, -x, -y);
            await measuredStore.put(
              record.id,
              tileKey(0, x / TILE_SIZE, y / TILE_SIZE),
              await canvas.convertToBlob({ type: "image/png" }),
            );
            progress();
          }
      } finally {
        bitmap.close();
      }
    }
    if (header.format === "jpeg")
      await decodeJPEG(file, header, record.id, record.backend, consume);
    else if (header.format === "png") {
      try {
        await decodePNG(file, header, consume);
      } catch (error) {
        if (error instanceof NativePNGRequired) await native();
        else throw error;
      }
    } else await native();
    await buildParents(levels, canvas, measuredStore, record.id, progress);
    canvas.width = canvas.height = 1;
    const ready: MapRecord = {
      ...record,
      width: header.width,
      height: header.height,
      levels,
      status: "ready",
      importMs: performance.now() - start,
      tileBytes: [...tileSizes.values()].reduce((sum, size) => sum + size, 0),
      decoder,
    };
    await saveMap(ready);
    reply({ type: "done", record: ready });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reply({
      type: "error",
      message: /quota|disk|space/i.test(message)
        ? t("Not enough device storage. Delete a map or free space and try again.")
        : message,
    });
  }
};
