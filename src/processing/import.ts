import { language, t } from "../i18n";
import type { ImportProgress, MapRecord, WorkerReply } from "../types";
import { readHeader } from "./headers";
import { chooseBackend, deleteStoredMap } from "../storage/payloads";
import { saveMap } from "../storage/database";
export async function importMap(
  file: File,
  onProgress: (p: ImportProgress) => void,
  signal: AbortSignal,
  /** Restored backups keep their map's identity, so restoring twice adds nothing. */
  id: string = crypto.randomUUID(),
) {
  if (signal.aborted) throw new DOMException(t("Import cancelled."), "AbortError");
  onProgress({ fraction: 0, message: t("Reading image metadata…") });
  const header = await readHeader(file);
  const record: MapRecord = {
    id,
    name: file.name,
    width: header.width,
    height: header.height,
    bytes: file.size,
    backend: await chooseBackend(),
    levels: [],
    created: Date.now(),
    status: "importing",
  };
  const estimate = await navigator.storage?.estimate?.();
  // Only the original is a known lower bound. Tile/scratch size depends on entropy;
  // let quota errors roll back instead of rejecting a map based on a rough guess.
  if (
    estimate?.quota &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < file.size
  )
    throw new Error(
      t("Device storage is too low to save the original file. Free space and try again."),
    );
  await navigator.storage?.persist?.().catch(() => false);
  await saveMap(record);
  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), {
    type: "module",
    name: language,
  });
  try {
    return await new Promise<MapRecord>((resolve, reject) => {
      const abort = () =>
        reject(new DOMException(t("Import cancelled."), "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      const finish = () => signal.removeEventListener("abort", abort);
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const message = event.data;
        if (message.type === "progress") onProgress(message.progress);
        if (message.type === "done") {
          finish();
          resolve(message.record);
        }
        if (message.type === "error") {
          finish();
          reject(new Error(message.message));
        }
      };
      worker.onerror = () => {
        finish();
        reject(
          new Error(
            t("Image processing stopped. Try again with a smaller file or a baseline JPEG."),
          ),
        );
      };
      if (signal.aborted) {
        finish();
        abort();
        return;
      }
      worker.postMessage({ file, record });
    });
  } catch (error) {
    worker.terminate();
    // Termination releases sync OPFS handles before interrupted files are removed.
    await deleteStoredMap(record).catch(() => {});
    throw error;
  } finally {
    worker.terminate();
  }
}
