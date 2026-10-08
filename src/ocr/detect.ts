import type { MapRecord, ImportProgress } from "../types";
import type { OcrIndex } from "./index";
import { saveOcr } from "../storage/ocr";

export type OcrReply =
  | { type: "progress"; progress: ImportProgress }
  | { type: "done"; index: OcrIndex }
  | { type: "error"; message: string };

// The owning worker isolates crop processing and also owns the OCR engine worker.
// Terminating it discards the scan and closes its owned OCR worker, even at startup.
export async function detectMapText(
  map: MapRecord,
  onProgress: (progress: ImportProgress) => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  onProgress({ fraction: 0, message: "Starting local text detection…" });
  const worker = new Worker(new URL("./ocr.worker.ts", import.meta.url), {
    type: "module",
  });
  let abort = () => {};
  try {
    const index = await new Promise<OcrIndex>((resolve, reject) => {
      abort = () => {
        worker.terminate();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<OcrReply>) => {
        const reply = event.data;
        if (reply.type === "progress") onProgress(reply.progress);
        else if (reply.type === "done") resolve(reply.index);
        else reject(new Error(reply.message));
      };
      worker.onerror = () =>
        reject(
          new Error(
            "Text detection stopped unexpectedly. Retry in Advanced settings.",
          ),
        );
      if (signal.aborted) abort();
      else worker.postMessage(map);
    });
    signal.throwIfAborted();
    await saveOcr(index);
    return index;
  } finally {
    signal.removeEventListener("abort", abort);
    worker.terminate();
  }
}
