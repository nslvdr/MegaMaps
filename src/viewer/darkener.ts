import { darkenedBitmap, type DarkLook } from "./appearance";
import type { DarkenReply } from "./darken.worker";
interface Request {
  blob: Blob;
  look: DarkLook;
  resolve(bitmap: ImageBitmap): void;
  reject(error: unknown): void;
}
// Dark mode recolors each tile once, on a worker so panning never waits for it.
// A CSS filter instead recolors the whole screen on every frame, which drains
// the battery underground.
export class Darkener {
  private worker?: Worker;
  private broken = typeof Worker === "undefined";
  private next = 0;
  private waiting = new Map<number, Request>();
  decode(blob: Blob, look: DarkLook) {
    if (this.broken) return darkenedBitmap(blob, look);
    const worker = (this.worker ??= this.start());
    const id = ++this.next;
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.waiting.set(id, { blob, look, resolve, reject });
      worker.postMessage({ id, blob, look });
    });
  }
  private start() {
    const worker = new Worker(new URL("./darken.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<DarkenReply>) => {
      const request = this.waiting.get(data.id);
      this.waiting.delete(data.id);
      if (!data.bitmap) request?.reject(new Error(data.error));
      else if (request) request.resolve(data.bitmap);
      else data.bitmap.close();
    };
    // A worker that cannot start leaves the work to this thread.
    worker.onerror = () => {
      worker.terminate();
      this.worker = undefined;
      this.broken = true;
      const waiting = [...this.waiting.values()];
      this.waiting.clear();
      for (const request of waiting)
        darkenedBitmap(request.blob, request.look).then(request.resolve, request.reject);
    };
    return worker;
  }
  dispose() {
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.waiting.values())
      request.reject(new DOMException("Closed", "AbortError"));
    this.waiting.clear();
  }
}
