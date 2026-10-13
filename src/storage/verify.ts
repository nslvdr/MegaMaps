import { language, t } from "../i18n";
import type { MapRecord } from "../types";
import type { VerificationReply } from "./verify.worker";
// Verification uses local payloads only. One worker decode is retained at a time.
export function verifyMap(
  map: MapRecord,
  progress: (fraction: number) => void,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException(t("Check cancelled."), "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./verify.worker.ts", import.meta.url), {
      type: "module",
      name: language,
    });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException(t("Check cancelled."), "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<VerificationReply>) => {
      const message = event.data;
      if (message.type === "progress")
        progress(message.checked / message.total);
      if (message.type === "done") {
        cleanup();
        resolve();
      }
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          t("Offline check stopped. Try again with Mega Maps in the foreground."),
        ),
      );
    };
    worker.postMessage(map);
  });
}
