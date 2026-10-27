# Design decisions

## Memory is the constraint

A 9,000² RGBA image is ~309 MiB decoded, so the app never decodes an original whole, not even in a worker. `createImageBitmap(blob, crop…)` gives no portable guarantee that its memory stays bounded. Imports stream the original into a reusable 512-row band and write 512² tiles in a factor-of-two pyramid. Each parent tile is built from at most four child tiles, decoded one after another. The viewer reads only tiles.

- **JPEG:** a vendored libjpeg-turbo WASM build reads the original through an OPFS sync handle in the worker. Progressive JPEG coefficients spill to OPFS scratch files through `native/jmemopfs.c`, which avoids SharedArrayBuffer, cross-origin isolation and async suspension. The WASM heap ceiling bounds only the decoder, not the process, so unfinished imports must stay recoverable from their metadata.
- **PNG:** compressed input is fed to `DecompressionStream` at most 4 KiB at a time, because [WebKit buffers each chunk's whole inflated output](https://docs.webkit.org/Deep%20Dive/Modules/CompressionStreams.html). Interlaced PNG and WebP fall back to a native decode, capped in size.
- **Tiles are lossless PNG** so they add no JPEG artifacts. As a result, a photographic original can grow about 6× on disk.
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

## OCR

- PaddleOCR models run with ONNX Runtime Web's single-threaded WASM backend, with no WebGPU and no SharedArrayBuffer. Parallel work comes from up to three workers, fewer on low-memory devices; each peaks around 330 MB.
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
- Trips, the map scale, display settings and the camera stay on the device and are not shared.
