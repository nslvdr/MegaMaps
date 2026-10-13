import { t } from "../i18n";
import type { Backend, ImageHeader } from "../types";
import type { RowConsumer } from "./png";
interface SyncFile {
  read(buffer: ArrayBufferView, options: { at: number }): number;
  write(buffer: ArrayBufferView, options: { at: number }): number;
  truncate(size: number): void;
  close(): void;
}
type SyncHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncFile>;
};
export interface JPEGModule {
  HEAPU8: Uint8Array<ArrayBuffer>;
  _decoder_open(): number;
  _decoder_height(): number;
  _decoder_row(): number;
  _decoder_finish(): number;
  _decoder_close(): void;
  _decoder_error(): number;
  UTF8ToString(pointer: number): string;
  ioError?: string;
}
export interface JPEGOptions {
  locateFile(path: string): string;
  readInput(offset: number, destination: Uint8Array): number;
  scratchIO?: (
    operation: number,
    id: number,
    bytes: Uint8Array,
    offset: number,
    count: number,
  ) => number;
  wasmBinary?: Uint8Array;
}
export type JPEGFactory = (options: JPEGOptions) => Promise<JPEGModule>;
export async function loadJPEG(): Promise<JPEGFactory> {
  const url = new URL("/codecs/jpeg.js", location.origin).href;
  const module: { default: JPEGFactory } = await import(/* @vite-ignore */ url);
  return module.default;
}
// Each import gets its own worker/WASM instance. Terminating it releases the heap.
export async function decodeJPEG(
  file: Blob,
  header: ImageHeader,
  id: string,
  backend: Backend,
  consume: RowConsumer,
  createDecoder: () => Promise<JPEGFactory> = loadJPEG,
) {
  const handles: SyncFile[] = [];
  let input: SyncFile | undefined, compressed: Uint8Array | undefined;
  let dir: FileSystemDirectoryHandle | undefined;
  try {
    if (backend === "opfs") {
      const root = await navigator.storage.getDirectory();
      dir = await (
        await root.getDirectoryHandle("maps")
      ).getDirectoryHandle(id);
      const original = (await dir.getFileHandle("original")) as SyncHandle;
      input = await original.createSyncAccessHandle();
      if (header.progressive) {
        for (let i = 0; i < 4; i++) {
          const handle = (await dir.getFileHandle(`scratch-${i}`, {
            create: true,
          })) as SyncHandle;
          handles.push(await handle.createSyncAccessHandle());
        }
      }
    } else {
      if (header.progressive && header.width * header.height > 4_000_000)
        throw new Error(
          t("Large progressive JPEG requires OPFS. Export a baseline JPEG or non-interlaced PNG on this browser."),
        );
      if (file.size > 64 * 1024 * 1024)
        throw new Error(t("JPEG over 64 MB requires OPFS on this browser."));
      compressed = new Uint8Array(await file.arrayBuffer());
    }
    let nextScratch = 0;
    const factory = await createDecoder();
    const module = await factory({
      locateFile: (path) => `/codecs/${path}`,
      readInput(offset, destination) {
        if (input) return input.read(destination, { at: offset });
        const count = Math.min(destination.length, compressed!.length - offset);
        destination.set(compressed!.subarray(offset, offset + count));
        return count;
      },
      scratchIO(operation, id, bytes, offset, count) {
        if (operation === 0) {
          const index = nextScratch++;
          const handle = handles[index];
          if (!handle) return -1;
          handle.truncate(count);
          return index;
        }
        const handle = handles[id];
        if (!handle) return -1;
        if (operation === 1) return handle.read(bytes, { at: offset });
        if (operation === 2) return handle.write(bytes, { at: offset });
        return 0;
      },
    });
    try {
      const width = module._decoder_open();
      if (!width)
        throw new Error(
          module.ioError ?? module.UTF8ToString(module._decoder_error()),
        );
      if (width !== header.width || module._decoder_height() !== header.height)
        throw new Error(t("JPEG dimensions changed during decoding."));
      for (let y = 0; y < header.height; y++) {
        const pointer = module._decoder_row();
        if (!pointer)
          throw new Error(
            module.ioError ?? module.UTF8ToString(module._decoder_error()),
          );
        await consume(
          new Uint8ClampedArray(module.HEAPU8.buffer, pointer, width * 4),
          y,
        );
      }
      if (!module._decoder_finish())
        throw new Error(
          module.ioError ?? module.UTF8ToString(module._decoder_error()),
        );
    } finally {
      module._decoder_close();
    }
  } finally {
    input?.close();
    for (const handle of handles) handle.close();
    if (dir)
      for (let i = 0; i < handles.length; i++)
        await dir.removeEntry(`scratch-${i}`).catch(() => {});
  }
}
