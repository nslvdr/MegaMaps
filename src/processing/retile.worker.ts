import type { MapRecord } from "../types";
import { payloadStore, type PayloadStore } from "../storage/payloads";
import { readHeader } from "./headers";
import { decodeJPEG } from "./jpeg";
import { buildParents, tileBand } from "./tiles";
export type RetileRequest = { map: MapRecord };
export type RetileReply =
  | { type: "done"; converted: boolean; tileBytes: number }
  | { type: "error"; message: string };
// Decodes a map into PNG tiles again. Each tile is replaced whole, so a
// map stopped midway still opens, and a later run starts it again.
onmessage = async (event: MessageEvent<RetileRequest>) => {
  const { map } = event.data,
    store = payloadStore(map.backend),
    canvas = new OffscreenCanvas(1, 1);
  const tileSizes = new Map<string, number>();
  const tiles: PayloadStore = {
    get: (id, key) => store.get(id, key),
    put: async (_id, key, tile) => {
      tileSizes.set(key, tile.size);
      await store.put(map.id, key, tile);
    },
    deleteMap: (id) => store.deleteMap(id),
  };
  try {
    const original = await store.get(map.id, "original"),
      header = await readHeader(original);
    const converted = header.format === "jpeg";
    if (converted) {
      await decodeJPEG(original, header, map.id, map.backend, tileBand(header, canvas, tiles, map.id, () => {}));
      await buildParents(map.levels, canvas, tiles, map.id, () => {});
    }
    const tileBytes = [...tileSizes.values()].reduce((sum, size) => sum + size, 0);
    postMessage({ type: "done", converted, tileBytes } satisfies RetileReply);
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies RetileReply);
  }
};
