import { darkenedBitmap, type DarkLook } from "./appearance";
export type DarkenReply = { id: number; bitmap?: ImageBitmap; error?: string };
onmessage = async ({ data }: MessageEvent<{ id: number; blob: Blob; look: DarkLook }>) => {
  try {
    const bitmap = await darkenedBitmap(data.blob, data.look);
    postMessage({ id: data.id, bitmap } satisfies DarkenReply, { transfer: [bitmap] });
  } catch (error) {
    postMessage({ id: data.id, error: String(error) } satisfies DarkenReply);
  }
};
