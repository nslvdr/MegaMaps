# Design decisions

## Memory is the constraint

A 9,000² RGBA image is ~309 MiB decoded, so the app never decodes an original whole, not even in a worker. `createImageBitmap(blob, crop…)` gives no portable guarantee that its memory stays bounded. Imports stream the original into a reusable 512-row band and write 512² tiles in a factor-of-two pyramid. Each parent tile is built from at most four child tiles, decoded one after another. The viewer reads only tiles.

- **JPEG:** a vendored libjpeg-turbo WASM build reads the original through an OPFS sync handle in the worker. Progressive JPEG coefficients spill to OPFS scratch files through `native/jmemopfs.c`, which avoids SharedArrayBuffer, cross-origin isolation and async suspension. The WASM heap ceiling bounds only the decoder, not the process, so unfinished imports must stay recoverable from their metadata.
- **PNG:** compressed input is fed to `DecompressionStream` at most 4 KiB at a time, because [WebKit buffers each chunk's whole inflated output](https://docs.webkit.org/Deep%20Dive/Modules/CompressionStreams.html). Interlaced PNG and WebP fall back to a native decode, capped in size.
- **JPEG tiles are cut, not re-encoded.** `cropper_row` in `native/jpeg.c` copies each 512² tile's DCT coefficients from the original into its own JPEG, so level 0 is the original's own pixels at about the original's size. A cut needs 512 to be a multiple of the iMCU and a grayscale, YCbCr or RGB original. CMYK, lossless and other JPEGs fall back to decoding into PNG tiles. Every cut spills coefficients to OPFS scratch, so it needs 3–6 bytes per pixel of free space while it runs (2 bytes per coefficient). With 4:2:0 chroma, pixels within 2 px of a cut differ slightly because chroma smoothing cannot cross the edge.
- **Zoomed-out levels are drawn from sharp PNG.** Each level is drawn from the PNG level below. A JPEG map then saves each zoomed-out level as JPEG 0.92 once, so loss never adds up from level to level, the way it did when each JPEG level was drawn from the JPEG below. Safari's JPEG halves colour resolution, so thin coloured lines still fade a little when zoomed out. PNG and WebP maps keep PNG at every level.
- **Tiling mode is a setting.** Settings › Your data › Map tiles picks how JPEG maps are stored. *Compact* (the default) cuts level 0 and saves zoomed-out levels as JPEG once from PNG (`CUT`). *Sharp* decodes into PNG at every level (`DECODED`), the way maps were stored before cutting, at about twice the space. A compact JPEG that can't be cut is decoded with JPEG zoomed-out levels and marked `UNCUT`.
- **Maps follow the mode in the background.** `src/processing/retile.ts` recuts JPEG maps whose `decoder` is another known format into the chosen mode, one map at a time, under the storage lock. Changing the setting restarts it. It skips the open map and the map being read for text, and stops for any change to the library. OPFS replaces each tile whole, so a map stopped halfway stays valid and is recut on the next launch. A map that fails is marked `UNCUT` and left alone.
- **Band width** limits images to 32,768 px per side. Wider images would need a different band layout.
- **OPFS detection** checks that a write actually works, not just that the API exists. Without OPFS, large progressive JPEG is rejected.
- Pixels become display RGBA8. ICC profiles, PNG gamma and high bit depth are not handled.

Benchmark baselines are in `docs/*-results.json`. Node RSS includes the test harness and native-canvas adapter, so it is not an iOS memory figure.

## Rendering

- Dark mode is applied to each tile's pixels once, as it decodes, in a worker. A CSS filter on the canvas recolors the whole screen every frame, and that measurably drained batteries underground. Brightness is a translucent fill drawn on frames that are rendered anyway.
- SVG annotations are a separate layer with no filter. They use the canvas camera but keep a constant screen size.
- The viewer controls map rotation only. It never locks screen orientation; the phone's own setting does that.
- In compass mode, the map turns only after a new heading has held for a while, so a swaying phone doesn't keep redrawing it.

## Persistence and integrity

- An import is marked `ready` only after every tile is written. A deletion writes a `deleting` tombstone first. At startup, abandoned records are cleaned up under an origin-wide Web Lock, so one window can't delete another window's active import.
- Annotation and OCR writes check the ready map metadata in the same transaction. This stops late writes from bringing a deleted map back.
- The camera saves only after resting for 2 s, so a moving or compass-turned map doesn't write several times a second.
- The service worker gets the whole shell before writing any of it, so a partial shell never activates. Map bytes never come from the network.
- An update copies each file an earlier version already holds, but only when its bytes hash to the new build's SHA-256; otherwise it downloads. The OCR models and runtime are 27 of the shell's 28 MB and rarely change.
- A page opened before an update keeps running under the new worker. The version just before keeps the hashed `/assets/` files that the new one renamed, so that page can still start its workers offline. Those files go at the next update.

## OCR

- PaddleOCR models run with ONNX Runtime Web's single-threaded WASM backend, with no WebGPU and no SharedArrayBuffer. Parallel work comes from up to three workers, fewer on low-memory devices and two when the device hides its memory (Safari); each peaks around 330 MB. A scan that opening a map starts waits a few seconds so the first tiles load first. Only the workers load ONNX Runtime; the page itself never does.
- Detection runs at the map's own resolution in overlapping sections, because shrinking the map first loses small print. Each label belongs to the one section whose middle holds its centre, so it is read once.
- The recognizer reads one line at a time. Batching costs the same per pixel and pads every line to the widest.
- Box fitting is implemented by hand to avoid an OpenCV dependency.
- Results don't depend on timing: worker output is merged in map order.
- An index has a version. Maps scanned by an older pipeline are scanned again when they open.

## Sharing format (`.megamap`)

- The container is binary (`MEGAMAP1`, manifest length, JSON manifest, then raw payloads) so already-compressed images and photos are never base64-encoded or compressed again.
- Every older version must stay readable. Older apps reject newer versions and ask to be updated.
- A map matches a shared file only through the SHA-256 of the original image bytes plus its dimensions. Filenames don't count, and a re-encoded image doesn't match.
- Merge never brings back imported items that were deleted locally, or log entries listed in `deletedLog`. Replace bumps a local annotation revision, so older saves can't restore removed items.
- Places, routes and log entries carry an optional `by`. Sending fills in the Settings nickname where it is missing, so what came from others keeps its author. No `by` means it was made on this device. An edit never folds into another person's entry. Older apps drop `by` without a version bump.
- Trips, the map scale, display settings and the camera stay on the device and are not shared.
