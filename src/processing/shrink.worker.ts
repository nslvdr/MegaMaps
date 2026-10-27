import { tileKey, type MapRecord } from "../types";
import { payloadStore } from "../storage/payloads";
import { readHeader } from "./headers";
import { cropJPEG } from "./jpeg";
import { buildParents } from "./tiles";
export type ShrinkReply =
  | { type: "done"; cut: boolean; tileBytes: number }
  | { type: "error"; message: string };
// Re-cuts a map imported with PNG tiles. Each tile is replaced whole, so a
// map stopped midway still opens, and a later run starts it again.
onmessage = async (event: MessageEvent<MapRecord>) => {
  const map = event.data,
    store = payloadStore(map.backend);
  let tileBytes = 0;
  const put = async (key: string, tile: Blob) => {
    tileBytes += tile.size;
    await store.put(map.id, key, tile);
  };
  try {
    const original = await store.get(map.id, "original"),
      header = await readHeader(original);
    const cut =
      header.format === "jpeg" &&
      (await cropJPEG(original, header, map.id, (x, y, tile) =>
        put(tileKey(0, x, y), tile),
      ));
    if (cut)
      await buildParents(
        map.levels,
        new OffscreenCanvas(1, 1),
        {
          get: (id, key) => store.get(id, key),
          put: (_id, key, tile) => put(key, tile),
          deleteMap: (id) => store.deleteMap(id),
        },
        map.id,
        () => {},
        "image/jpeg",
      );
    postMessage({ type: "done", cut, tileBytes } satisfies ShrinkReply);
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies ShrinkReply);
  }
};
