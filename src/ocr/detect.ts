import type { MapRecord, ImportProgress } from "../types";
import type { OcrLine } from "./index";
import { ocrCrops, scanMap } from "./scan";
import { saveOcr } from "../storage/ocr";

export interface OcrRequest {
  map: MapRecord;
  section: number;
}
export type OcrReply =
  | { type: "progress"; fraction: number }
  | { type: "lines"; lines: OcrLine[] }
  | { type: "error"; message: string };

// Each worker peaks around 330 MB with its own models, so the pool stays small,
// and smaller still on phones that report little memory.
const MAX_WORKERS = 3;
const WORKER_MEMORY_GB = 2;

function ocrWorkerCount(sections: number) {
  const { hardwareConcurrency, deviceMemory } = navigator as Navigator & {
    deviceMemory?: number;
  };
  return Math.max(
    1,
    Math.min(
      MAX_WORKERS,
      sections,
      (hardwareConcurrency || 2) - 1,
      Math.floor((deviceMemory ?? 8) / WORKER_MEMORY_GB),
    ),
  );
}

// Sections are spread over several single-threaded workers. Terminating them
// discards the scan, even while the models are still loading.
export async function detectMapText(
  map: MapRecord,
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  onProgress({ fraction: 0, message: "Finding text · 0%" });
  const workers = Array.from(
    { length: ocrWorkerCount(ocrCrops(map.width, map.height).length) },
    () =>
      new Worker(new URL("./ocr.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  let abort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    const scanners = workers.map(
      (worker) => (section: number, onPart: (fraction: number) => void) =>
        new Promise<OcrLine[]>((resolve, reject) => {
          worker.onmessage = ({ data: reply }: MessageEvent<OcrReply>) => {
            if (reply.type === "progress") onPart(reply.fraction);
            else if (reply.type === "lines") resolve(reply.lines);
            else reject(new Error(reply.message));
          };
          worker.onerror = () =>
            reject(
              new Error(
                "Text detection stopped unexpectedly. Retry in Advanced settings.",
              ),
            );
          worker.postMessage({ map, section } satisfies OcrRequest);
        }),
    );
    const index = await Promise.race([
      scanMap(map, scanners, onProgress, signal),
      aborted,
    ]);
    signal.throwIfAborted();
    await saveOcr(index);
    return index;
  } finally {
    signal.removeEventListener("abort", abort);
    for (const worker of workers) worker.terminate();
  }
}
