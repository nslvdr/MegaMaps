import { language } from "../i18n";
import { listMaps, recordTiles } from "../storage/database";
import { CHAINED_JPEG_PARENTS, CUT, DECODED, PNG_PARENTS, UNCUT } from "./jpeg";
import type { RetileReply, RetileRequest } from "./retile.worker";
/** Older and compact tile formats a JPEG map is recut from. Maps that failed once (UNCUT) are left alone. */
const RECUTTABLE = [CHAINED_JPEG_PARENTS, PNG_PARENTS, CUT];
function retile(request: RetileRequest, signal: AbortSignal) {
  return new Promise<RetileReply | undefined>((resolve) => {
    if (signal.aborted) return resolve(undefined);
    const worker = new Worker(new URL("./retile.worker.ts", import.meta.url), {
      type: "module",
      name: language,
    });
    const finish = (reply?: RetileReply) => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      resolve(reply);
    };
    const stop = () => finish();
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<RetileReply>) => finish(event.data);
    worker.onerror = () => finish({ type: "error", message: "" });
    worker.postMessage(request);
  });
}
/**
 * JPEG maps saved in an older tile format are recut in the background, one at
 * a time under the storage lock. It skips busy maps and ends when there is
 * nothing left, when another window holds storage, or when stopped. A stopped
 * map keeps working tiles and is recut on a later run.
 */
export function startRetiling(
  busy: (id: string) => boolean,
  /** Files read before a cut can no longer be read once their tiles are replaced. */
  replaced: (id: string) => void,
) {
  const controller = new AbortController();
  const tried = new Set<string>();
  let mapId: string | undefined;
  const done = (async () => {
    for (;;) {
      const map = (await listMaps()).find(
        (map) =>
          map.status === "ready" &&
          map.backend === "opfs" &&
          RECUTTABLE.includes(map.decoder ?? "") &&
          !tried.has(map.id) &&
          !busy(map.id),
      );
      if (!map || controller.signal.aborted) return;
      tried.add(map.id);
      mapId = map.id;
      const reply = await navigator.locks.request(
        "map-viewer-storage",
        { ifAvailable: true },
        (lock) => (lock ? retile({ map }, controller.signal) : undefined),
      );
      mapId = undefined;
      if (!reply) return;
      const converted = reply.type === "done" && reply.converted;
      if (converted) replaced(map.id);
      // A failed map keeps its tiles and is not tried again.
      await recordTiles(
        map.id,
        converted
          ? { decoder: DECODED, tileBytes: reply.tileBytes }
          : { decoder: UNCUT, tileBytes: map.tileBytes },
      ).catch(() => {});
    }
  })().catch(() => {});
  return {
    done,
    get mapId() {
      return mapId;
    },
    stop() {
      controller.abort();
      return done;
    },
  };
}
