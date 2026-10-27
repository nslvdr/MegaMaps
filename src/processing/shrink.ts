import { language } from "../i18n";
import { listMaps, recordTiles } from "../storage/database";
import type { MapRecord } from "../types";
import { CUT, DECODED, UNCUT } from "./jpeg";
import type { ShrinkReply } from "./shrink.worker";
function shrink(map: MapRecord, signal: AbortSignal) {
  return new Promise<ShrinkReply | undefined>((resolve) => {
    if (signal.aborted) return resolve(undefined);
    const worker = new Worker(new URL("./shrink.worker.ts", import.meta.url), {
      type: "module",
      name: language,
    });
    const finish = (reply?: ShrinkReply) => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      resolve(reply);
    };
    const stop = () => finish();
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<ShrinkReply>) => finish(event.data);
    worker.onerror = () => finish({ type: "error", message: "" });
    worker.postMessage(map);
  });
}
/**
 * Maps imported with PNG tiles get lossless JPEG tiles in the background, one
 * at a time under the storage lock. It skips busy maps and ends when there is
 * nothing left, when another window holds storage, or when stopped. A stopped
 * map keeps working tiles and is shrunk on a later run.
 */
export function startShrinking(
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
          map.decoder === DECODED &&
          !tried.has(map.id) &&
          !busy(map.id),
      );
      if (!map || controller.signal.aborted) return;
      tried.add(map.id);
      mapId = map.id;
      const reply = await navigator.locks.request(
        "map-viewer-storage",
        { ifAvailable: true },
        (lock) => (lock ? shrink(map, controller.signal) : undefined),
      );
      mapId = undefined;
      if (!reply) return;
      if (reply.type === "done" && reply.cut) replaced(map.id);
      // A failed map keeps its tiles and is not tried again.
      await recordTiles(
        map.id,
        reply.type === "done" && reply.cut
          ? { decoder: CUT, tileBytes: reply.tileBytes }
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
