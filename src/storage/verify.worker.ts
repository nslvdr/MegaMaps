import { t } from "../i18n";
import { TILE_SIZE, tileKey, type MapRecord } from "../types";
import { payloadStore } from "./payloads";
export type VerificationReply =
  | { type: "progress"; checked: number; total: number }
  | { type: "done" }
  | { type: "error"; message: string };
const reply = (message: VerificationReply) => postMessage(message);
onmessage = async (event: MessageEvent<MapRecord>) => {
  const map = event.data,
    store = payloadStore(map.backend);
  const total = map.levels.reduce((sum, l) => sum + l.cols * l.rows, 0);
  let checked = 0,
    last = 0;
  try {
    if (!total) throw new Error(t("This map has no prepared tiles."));
    for (let index = 0; index < map.levels.length; index++) {
      const level = map.levels[index]!;
      for (let y = 0; y < level.rows; y++)
        for (let x = 0; x < level.cols; x++) {
          const key = tileKey(index, x, y),
            blob = await store.get(map.id, key);
          const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
          const expectedWidth = Math.min(
              TILE_SIZE,
              level.width - x * TILE_SIZE,
            ),
            expectedHeight = Math.min(TILE_SIZE, level.height - y * TILE_SIZE);
          // Check size before decoding: a corrupted header must never trigger a huge bitmap.
          if (
            header.length !== 24 ||
            header[0] !== 137 ||
            String.fromCharCode(...header.subarray(1, 8)) !== "PNG\r\n\x1a\n" ||
            new DataView(header.buffer).getUint32(16) !== expectedWidth ||
            new DataView(header.buffer).getUint32(20) !== expectedHeight
          )
            throw new Error(t("Tile {key} is damaged.", { key }));
          const bitmap = await createImageBitmap(blob);
          try {
            if (
              bitmap.width !== expectedWidth ||
              bitmap.height !== expectedHeight
            )
              throw new Error(t("Tile {key} has incorrect dimensions.", { key }));
          } finally {
            bitmap.close();
          }
          checked++;
          if (performance.now() - last > 100 || checked === total) {
            last = performance.now();
            reply({ type: "progress", checked, total });
          }
        }
    }
    reply({ type: "done" });
  } catch (error) {
    reply({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
