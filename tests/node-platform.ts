// A filesystem + native-canvas test adapter, not a browser. It exercises the
// production scanline/tile code; it cannot prove Safari's encoder, GPU, or quotas.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import {
  openSync,
  closeSync,
  readSync,
  writeSync,
  ftruncateSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JPEGFactory } from "../src/processing/jpeg";
export const nativeStats = {
  decodedBytes: 0,
  peakDecodedBytes: 0,
  scratchAllocatedBytes: 0,
  peakScratchBytes: 0,
  scratchWriteBytes: 0,
  wasmHeapBytes: 0,
};
class CanvasAdapter {
  private canvas;
  constructor(width: number, height: number) {
    this.canvas = createCanvas(width, height);
  }
  get width() {
    return this.canvas.width;
  }
  set width(value: number) {
    this.canvas.width = value;
  }
  get height() {
    return this.canvas.height;
  }
  set height(value: number) {
    this.canvas.height = value;
  }
  getContext() {
    return this.canvas.getContext("2d");
  }
  // Hands over the drawing as a bitmap and starts a blank one, like browsers.
  transferToImageBitmap() {
    const drawn = this.canvas;
    this.canvas = createCanvas(drawn.width, drawn.height);
    return Object.assign(drawn, { close() {} });
  }
  async convertToBlob(options?: { type?: string; quality?: number }) {
    const bytes =
      options?.type === "image/jpeg"
        ? await this.canvas.encode("jpeg", Math.round((options.quality ?? 0.92) * 100))
        : await this.canvas.encode("png");
    return new Blob([new Uint8Array(bytes)], { type: options?.type ?? "image/png" });
  }
}
class Directory {
  constructor(private root: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const dir = path.join(this.root, name);
    if (options?.create) await mkdir(dir, { recursive: true });
    else await stat(dir);
    return new Directory(dir);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const file = path.join(this.root, name);
    if (options?.create) {
      const handle = await open(file, "a");
      await handle.close();
    } else await stat(file);
    return {
      async getFile() {
        return new Blob([new Uint8Array(await readFile(file))]);
      },
      async createWritable() {
        const handle = await open(file, "w");
        return {
          async write(blob: Blob) {
            const reader = blob.stream().getReader();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                await handle.write(value);
              }
            } finally {
              reader.releaseLock();
            }
          },
          close: () => handle.close(),
          abort: () => handle.close(),
        };
      },
      async createSyncAccessHandle() {
        const fd = openSync(file, "r+");
        const scratch = name.startsWith("scratch-");
        let allocated = 0;
        return {
          read: (buffer: Uint8Array, options: { at: number }) =>
            readSync(fd, buffer, 0, buffer.byteLength, options.at),
          write: (buffer: Uint8Array, options: { at: number }) => {
            const n = writeSync(fd, buffer, 0, buffer.byteLength, options.at);
            if (scratch) nativeStats.scratchWriteBytes += n;
            return n;
          },
          truncate: (size: number) => {
            ftruncateSync(fd, size);
            if (scratch) {
              nativeStats.scratchAllocatedBytes += size - allocated;
              allocated = size;
              nativeStats.peakScratchBytes = Math.max(
                nativeStats.peakScratchBytes,
                nativeStats.scratchAllocatedBytes,
              );
            }
          },
          close: () => {
            closeSync(fd);
            if (scratch) nativeStats.scratchAllocatedBytes -= allocated;
          },
        };
      },
    };
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    try {
      await rm(path.join(this.root, name), {
        recursive: options?.recursive ?? false,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new DOMException("Missing", "NotFoundError");
      throw error;
    }
  }
}
export async function installPlatform(root: string) {
  await mkdir(root, { recursive: true });
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => new Directory(root) },
  });
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: CanvasAdapter,
    configurable: true,
  });
  const blank = createCanvas(1, 1).toBuffer("image/png");
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (blob: Blob) => {
      const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
      const bytes = image.width * image.height * 4;
      let closed = false;
      nativeStats.decodedBytes += bytes;
      nativeStats.peakDecodedBytes = Math.max(
        nativeStats.peakDecodedBytes,
        nativeStats.decodedBytes,
      );
      Object.defineProperty(image, "close", {
        value: () => {
          if (!closed) {
            nativeStats.decodedBytes -= bytes;
            closed = true;
            image.src = blank;
          }
        },
      });
      return image;
    },
  });
}
export async function jpegFactory(): Promise<JPEGFactory> {
  const url = new URL("../public/codecs/jpeg.js", import.meta.url);
  const module: { default: JPEGFactory } = await import(url.href);
  const wasmBinary = new Uint8Array(
    await readFile(
      fileURLToPath(new URL("../public/codecs/jpeg.wasm", import.meta.url)),
    ),
  );
  return async (options) => {
    const decoder = await module.default({ ...options, wasmBinary });
    nativeStats.wasmHeapBytes = Math.max(
      nativeStats.wasmHeapBytes,
      decoder.HEAPU8.byteLength,
    );
    return decoder;
  };
}
