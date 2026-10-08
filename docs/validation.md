# Validation recorded on 2026-10-05

Initial image-pipeline milestone: **14 tests passed**, with a production shell of 13 assets. Production HTTP verification served all 15 requested resources, including HTML/SW, worker code, codec JS/WASM, icons and manifest; WASM MIME and manifest fields were valid.

Cave-tools milestone: **24 tests passed** and strict TypeScript + production Vite build passed. The updated shell precaches 14 assets, including the new verification worker. Production HTTP checks confirmed all 14 nonempty shell resources plus the service worker, correct WASM MIME and standalone manifest. The benchmarks below remain the initial pipeline measurements; cave controls do not change import/tiling. No new physical-device performance measurements have been made.

The production service-worker handlers were exercised in a Node VM with network fetching disabled: cold navigation, the module worker, and both codec resources came from the cache. This verifies handler behavior and cache inventory, **not** actual iOS installation/service-worker lifecycle.

## OCR milestone — 2026-10-08

**48 tests passed** and strict TypeScript + production build passed. The shell includes 21 assets, including the OCR owner worker, local Tesseract worker, three embedded-WASM cores and English model. The offline-handler test covers OCR code/model responses with network fetching disabled.

Actual local Tesseract detection on native-canvas fixtures found labels at 0°, 37°, 90°, 173°, 254° and white-on-dark text at −58°, including text crossing native tile boundaries. Tests verify inverse polygon coordinates, bounded crop plans, one live tile decode, case/accent/phrase search, mask alignment under camera rotation, startup cancellation, failure preserving the old index, replacement commits, rename/deletion protection, search controls and upgrades from database versions 1 and 2. These are Node/DOM-adapter tests; no browser automation or physical-device OCR timing, keyboard layout or cold-offline OCR initialization was tested.

## Full image preprocessing benchmarks

Host: Apple M4 Pro, macOS 27.0.1, Node v24.9.0. Each table row used a separate process. Values are rounded.

| Input                           | Original MiB | Tiles | Total import s | Tiles MiB | Initial → sampled peak RSS MiB | Band MiB |
| ------------------------------- | -----------: | ----: | -------------: | --------: | -----------------------------: | -------: |
| map-1000.png                    |         0.06 |     5 |           0.05 |      0.06 |                      138 → 149 |     1.95 |
| map-4000.png                    |         0.90 |    85 |           0.64 |      0.78 |                      133 → 170 |     7.81 |
| map-9000.png                    |         5.27 |   444 |           3.09 |      3.49 |                      132 → 202 |    17.58 |
| map-9000.jpg                    |         4.33 |   444 |           2.86 |     11.03 |                      131 → 188 |    17.58 |
| map-9000-detail-progressive.jpg |        27.44 |   444 |          16.84 |    168.43 |                      143 → 333 |    17.58 |
| map-15000.png                   |        16.56 |  1210 |           8.59 |      9.13 |                      142 → 283 |    29.30 |

All imports completed their full native and parent tile inventory. Each output passed **36 exact RGBA sample comparisons** at interior points, tile boundaries, and final image edges. Large JPEG input is streamed through the same synchronous filesystem callback used by worker OPFS. The latest detailed progressive JPEG run verified that coefficient spill actually occurred, every scratch handle closed, and every scratch file was removed **before** parent generation.

The detailed progressive fixture was created at JPEG quality 88. Its 27.44 MiB original became 168.43 MiB of lossless PNG tiles. Its coefficient backing files reached 232.16 MiB of temporary logical file size; repeated progressive scans wrote about 1.21 GiB cumulatively. The WASM heap remained 32 MiB, the scanline band was 17.58 MiB, and sequential parent generation retained at most one 1 MiB child bitmap. The helper for future detailed fixtures uses quality 82, so generated sizes will differ.

RSS includes Node, the TypeScript runner, native-canvas, encoding buffers, allocator retention, and filesystem/Blob adapters. It is sampled at row/tile boundaries and can miss transient native encoder spikes. It is **not** an iOS memory result. Small JavaScript heaps likewise do not imply small browser/GPU memory. See [raw results](benchmark-results.json) for all recorded fields.

## What the focused tests cover

- Fit geometry, cursor zoom anchoring, DPR-aware level choice, visible edge tile bounds.
- PNG filters, packed palettes, transparency, 16-bit conversion, truncated data rejection.
- Actual JPEG WASM scanlines, CMYK conversion, lossless base tiles, odd-sized parent edges, decoder failure cleanup.
- Two concurrent tile decodes, the decoded-byte budget, queue replacement during viewport changes, bitmap disposal.
- IndexedDB fallback payload persistence and deletion isolation for neighbouring map IDs.
- The actual worker processor on a Node platform adapter: every tile is stored before ready metadata; malformed imports stay recoverable.
- Atomic service-worker shell inventory and cold offline handler behavior.
- Rotated fit/inverse transforms, twist anchor preservation, rotated visible-tile coverage and saved views across viewport changes.
- Upgrade from IndexedDB v1 without losing maps or payloads; navigation/settings persistence, serialized saves and protection against late writes after deletion.
- Touch/rotation locks, editing taps, one-second hold-to-unlock, bookmark editing, draft undo and route completion through Node DOM/event adapters.
- Real viewer canvas code through a Node DOM/native-canvas adapter: restored rotation, rotation retention during fit animation, inversion/dimming restricted to the canvas, compensated dark margins, legible overlay labels and locked camera controls.
- Offline verification worker detecting damaged/missing tiles while retaining at most one decoded verification bitmap. Service-worker shell verification detects a missing WASM cache entry without network fallback.
- Tools-sheet controls through the Node DOM adapter: saved-row ⋯ popover menus (outside tap/Escape), moving places, route-point dragging with undo, snapping and clamping, outside/Close/Escape dismissal, normal toolbar restoration, the Add pill swap (Place / Route), tap-to-place with a prefilled place card and locked/unlocked transitions. Layout appearance and touch ergonomics still need physical-device review.

## Physical-device acceptance checklist — pending

Use the **production** HTTPS preview and keep the same origin. No browser/computer-use testing was performed in this implementation session.

1. On a real iPhone, import the 9k detailed baseline and progressive JPEG plus the 15k PNG. Record model, iOS version, elapsed time and Safari/Web Inspector process/native memory, not only JS heap.
2. Keep interacting with the progress dialog during import. Check cancellation, storage-full handling and foreground responsiveness. Interrupt one import by closing the app; reopen and verify incomplete work is removed.
3. Open each map at fit, pinch repeatedly into native detail, pan/fling across tile boundaries, double tap, rotate the device, and reset. Record frame pacing during movement, checkerboarding/load latency, crashes/reloads and zoom anchoring.
4. In the attached device console, inspect `window.MapViewer.diagnostics()` while viewing. Confirm decoded cache ≤24 MiB, display canvas ≤16 MiB and loading queue tracks only the viewport. The active-frame mean is diagnostic, not a reliable sustained-FPS benchmark.
5. Install/Add to Home Screen, import fully, wait for Available offline in the footer, close all app windows, enable Airplane Mode, and launch from the home-screen icon. Verify library, native-resolution viewing, zoom, pan and reset with no network.
6. Close/reopen the installed app and restart the phone. Verify persistent maps. Delete one map and verify it stays deleted without affecting others.
7. Repeat installation, offline cold launch, persistence, pinch gestures and memory checks on Android Chrome. Also validate WebP/interlaced PNG below 16 MP, explicit rejection above that limit, and the IndexedDB fallback on a browser without OPFS.
8. In Airplane Mode, confirm the footer reports No internet and Available offline, then open imported maps and inspect native detail across the map.
9. Invert a detailed 9k map and lower its map light. Verify dark margins, readable cyan/amber/purple overlays and smooth gestures. Compare native/compositor memory and active movement pacing with filters on/off.
10. Test default map rotation lock with pinch/twist; unlock, rotate with two fingers and buttons, fit, resize, relock and reopen.
11. Add/edit notes, plan a return route, close with an unfinished draft, reopen and continue. Jump between saved places and confirm that a map saved with checkpoints by an older version shows them as landmark places. Drag route points while editing (including a second finger mid-drag, which should put the point back and pinch), move a place from its ⋯ menu, and check the ⋯ menu opens upward near the bottom of the panel. Verify overlay alignment through rotation/native zoom and persistence after restart.
12. Tap **Lock** in the bottom pill: with it on (orange), drag, pinch and double tap still move/zoom but a two-finger twist must not rotate; with it off, twisting rotates and View shows the rotation slider. Reopen the map and confirm the lock state is kept.
13. Open an older map and verify background text detection starts. In Search, check the phone keyboard, matching words, clear/close, previous/next results and alignment while panning/zooming/rotating. Use ⋯ to rename, stop/rerun detection and delete. Repeat a fresh OCR scan in Airplane Mode after the shell is cached; record detection time and native memory on a large map.

The next engineering decision should follow these device results: tune scanline/cache budgets and import tile encoding before increasing supported formats or implementing future map features.
