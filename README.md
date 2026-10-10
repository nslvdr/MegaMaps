# Mega Maps

A mobile-first, private, offline PWA for exploring large local maps. No accounts, uploads, backend, external fonts, analytics, or runtime CDN dependencies.

## Run

```sh
npm install
npm run dev
```

Development: **http://localhost:5173**. The development server intentionally does not install a service worker.

To test installation and offline use, run the production build:

```sh
npm run build
npm run preview
```

Production preview: **http://localhost:4173**. Import a map, wait for **Available offline** in the footer, then go offline and reload. Keep the same origin/port: browser storage belongs to the origin. Build output is in `dist/` and can be served by any static HTTPS host.

## Search map text

Importing a map also runs local OCR. **Search** in the viewer’s bottom bar opens a text box: matching words remain clear while the rest of the map darkens. Search ignores case and accents, supports phrases and partial words, and offers previous/next controls to frame results. Clearing the query or closing Search restores the normal view. On a keyboard, **/** opens Search ready to type.

Older maps automatically run detection when opened if they have no current OCR index. In the library, **Advanced settings (tools icon) → Rerun text detection** starts a fresh scan; you can stop it there. The previous index remains usable until a replacement completes. Stopping OCR during import keeps the saved map. Share, Rename and Delete are also available on each map card.

Detection runs a bundled PaddleOCR mobile text detector once per overlapping section, estimates each label’s angle, then straightens and reads only those label crops with Tesseract's fast English LSTM model. A second recognition pass checks the opposite reading direction when the first result has low confidence. The engines start together, detector input is capped at 768 pixels, and a 4 MiB tile cache reuses shared section edges. This supports angled, vertical and upside-down labels; detection is best-effort for tiny, curved, stylized or low-contrast text. Large maps may take several minutes or longer on a phone. Keep the app open until detection finishes. Both engines and models are included in the offline shell; map pixels and detected text never leave the device.

## Deploy to Cloudflare

The `mega-maps` Worker serves the production files from `dist/` at **https://mega-maps.natan-slvdr.fr** using Cloudflare static assets. The service worker, image-processing workers, and JPEG WASM codec are included in the deployment.

```sh
npx wrangler login                        # Once per development machine
npm run deploy                            # Build and publish
```

Custom domains are configured in `wrangler.jsonc`. Cloudflare manages their DNS records and HTTPS certificates. Imported maps and annotations remain in each device's browser storage.

### On an iPhone or Android device

An ordinary `http://192.168…` LAN address is **not** a secure context; service workers and OPFS require HTTPS (desktop `localhost` is an exception). Use a trusted development certificate for your computer's LAN address, trust its issuing certificate on the phone, then:

```sh
npm run build
MAP_VIEWER_HTTPS_CERT=/absolute/path/cert.pem \
MAP_VIEWER_HTTPS_KEY=/absolute/path/key.pem npm run preview
```

Open the HTTPS LAN URL shown by Vite. In Safari, Share → Add to Home Screen; in Chrome, menu → Install app. Finish importing and wait for **Available offline** in the footer before enabling Airplane Mode. Safari/iOS 17+ is the recommended minimum; current Android Chrome and desktop Safari/Chrome/Firefox are the development targets.

## Project structure

```text
src/
  main.ts                   Library, import progress, dialogs, fullscreen UI
  style.css                 Responsive dark UI and safe-area layout
  storage/
    database.ts             IndexedDB metadata + transaction commits
    payloads.ts             OPFS / IndexedDB payload abstraction, deletion
    navigation.ts           Saved camera, notes/routes, settings, throttled writes
    ocr.ts                  Atomic text indexes and deletion protection
    verify.ts / .worker.ts  Offline tile inventory + sequential decode checks
  processing/
    headers.ts              Container metadata without decoding pixels
    import.ts               Worker lifecycle, cancellation, quota preflight
    import.worker.ts        Local preprocessing and final metadata commit
    jpeg.ts                 WASM scanline decoder, OPFS scratch handles
    png.ts                  Streamed inflate, filters, packed/16-bit pixels
    tiles.ts                Reusable scanline band and sequential parent tiles
    pyramid.ts              Resolution and tile inventory
  viewer/
    camera.ts               Fit, constraints, zoom anchoring, visible tiles
    interactions.ts         Pointer pinch/pan, wheel, double tap, inertia
    cache.ts                Byte-limited LRU, two decodes, obsolete queue removal
    viewer.ts               Viewport canvas, level selection, diagnostics
    navigation.ts           Map tools data in original-image coordinates
    overlays.ts             SVG markers/routes, independent of color inversion
    search-overlay.ts       Rotated search polygons and screen-space dimming mask
  ocr/
    detect.ts / .worker.ts  Background detection lifecycle and cancellation
    scan.ts                 Bounded sections, straightened labels and coordinates
    detector.ts             Local ONNX text detector, normalization and disposal
    regions.ts              Oriented text boxes and overlap suppression
    index.ts                Text normalization, phrase matching, duplicate removal
  ui/
    viewer-markup.ts         Touch controls, tools panel, local note forms
    viewer-controls.ts       Navigation commands, dialogs and persistence
  pwa.ts                    Production service-worker registration
public/
  manifest.webmanifest
  icons/                    Local PNG home-screen icons + SVG favicon
  codecs/                   Shipped JPEG JS/WASM + third-party license
  ocr/                      Generated local OCR workers, WASM cores and models
native/                     Rebuildable libjpeg wrapper and OPFS memory manager
scripts/                    SW build, icons, fixtures, decoder rebuild, benchmarks
tests/                      Decoder, tile, camera, cache, storage, offline tests
docs/                       Architecture details and recorded benchmark results
```

## Large-image architecture

See [architecture.md](docs/architecture.md) for implementation details and budgets. The viewer **never opens the original image**. It renders a viewport-sized canvas from locally stored 512 × 512 lossless PNG tiles in a factor-of-two pyramid.

- JPEG is decoded a scanline at a time by a small vendored libjpeg-turbo WASM codec. OPFS synchronous file handles stream the compressed input. Progressive JPEG coefficient arrays spill into temporary files instead of consuming RAM proportional to image area.
- Non-interlaced PNG is inflated in small compressed chunks, unfiltered one row at a time, and converted into a reusable 512-row tile band. No full-resolution RGBA bitmap/canvas is created.
- Each lower resolution reads one already-stored child tile at a time. Resolutions are not simultaneously decoded.
- A 9k image uses a 17.6 MiB scanline band, versus approximately 309 MiB for a full RGBA image. The JPEG heap starts at 32 MiB and has a 96 MiB hard ceiling; coefficient buffers target 12 MiB.
- Viewing retains at most 24 MiB of decoded cached tiles, a ≤1 MiB overview, two tile decodes in flight, and a ≤16 MiB display canvas. Native codec/GPU/encoder overhead is additional. At very large display sizes the chosen level can be coarser to preserve the cache budget.

The original remains locally stored. Metadata is committed as ready **only after** every pyramid tile exists. Cancelled imports are cleaned up; interrupted imports/deletions leave recoverable records. An origin-wide Web Lock prevents another window's startup cleanup from deleting an active import.

## Using the viewer

**Updating without reinstalling:** use **Update app** beside the Mega Maps title in the main menu. While online, the app downloads and verifies the latest application files, saves pending navigation changes, and reloads when a newer version is ready. Maps, places, routes and settings stay in their existing on-device storage. If installation or saving fails, the page stays open. Reinstalling is unnecessary for ordinary updates; iOS installation settings such as the status-bar style may still require a fresh Home Screen installation.

The main-menu footer shows the release date of the loaded version, internet connectivity, live-site availability and verified offline-shell readiness. A fresh request checks the live site; cached files cannot produce a successful online check. When the browser reports a network but the site cannot be reached, internet connectivity is shown as unconfirmed. Offline readiness covers application files. Maps are stored locally when import completes; the footer does not check map tiles.

Drag to pan; pinch to zoom. **Double-tap and drag** down/up zooms with one thumb; a plain double tap zooms in (at deep zoom it returns to fit) and a **two-finger tap** zooms out. **Long-press** the map to drop a place. Wheel/trackpad zoom is centered on the cursor.

The map fills the screen. Fingers move it, so there are no zoom or pan buttons; only a few controls float over it:

- **Top left:** **Back** to the library.
- **Bottom pill:** **Saved** (routes, places) · **View** (dark map, brightness, rotation, layers, highlight) · **Add** (place, route) · **Lock** (map rotation lock; orange while locked).

**Saved** and **View** open a panel just above the pill, and their button stays highlighted while it is open: tap another button to switch, or the same button, the map, Close or Escape to dismiss (you can also swipe the panel header down). Keyboard: arrows pan (Shift+arrow pans half a screen), `+`/`−` zoom, `0` or `F` fits; Escape closes the panel or the Add choice, then finishes the current tool, then returns home. The viewer supports native resolution and up to 400% CSS zoom; native-level pixels are not interpolated when enlarged.

### Cave and quarry tools

- **Dark map (on by default):** the overview tile is analysed once. Light maps are inverted with hue preserved and contrast stretched so the paper becomes **pure black** (OLED pixels off, which saves battery) and the ink stays bright but not glaring. Dark-gray maps have their background deepened to black without inverting. Maps that are already black are left untouched. The margin around the map is also pure black. The map starts slightly dimmed (85%) so your routes and places stand out; they stay at full strength unless you dim further. **View › brightness** adjusts it (20–100%); the Dark map switch is in View too. Only the canvas is filtered; the original files and tiles are untouched. This is a software display adjustment, not hardware brightness control.
- **Add (+):** opens no panel. The pill stays put, its **+** turns into **×**, and two big buttons, **Place** and **Route**, rise just above it. Then just tap the map: a slim hint above the pill says what to tap (routes add **Undo** and **Done** at its end), and the same **×** cancels, so the way out is always where you came in. While placing, Saved and View wait until you're done. Tapping a spot for a place opens a card at the bottom with the five kinds shown as their map pins and a prefilled name such as "Landmark 3" (it follows the kind until you type your own), so **Save** works without the keyboard; a note is one **Add note** tap away.
- **Planned routes:** Add › Route starts drawing right away. Tap along passages; while drawing or editing, the points become handles you can **drag** to adjust (pinching still zooms). Points snap to nearby places when tapped or dropped, and **Undo** (or ⌘Z, Ctrl+Z, Backspace) steps back through your taps and drags. **Done** saves the route once it has 2 or more points. **×** cancels: a new route is discarded and a continued or edited one goes back to how it was; if that would throw away 2 or more points it asks first (tap × again). Routes get distinct colors with start and end markers. In **Saved**, tap a route to frame it; its **⋯** menu continues it, edits its points, renames it or deletes it (tap Delete twice).
- **View:** a **Map** card (dark map, brightness, and rotation while Lock is off), a **Show on map** card with a switch for routes, places and names, then a **Highlight** button. **Highlight** darkens the map for a few seconds while every saved item glows and pulses, including hidden layers.
- **Saved:** one list with a Routes section and a Places section; each place shows the same pin as on the map. Tap a row to jump to it. Its **⋯** opens a small menu beside it: routes have Edit points (or Continue), Rename and Delete; places have Edit, **Move** (the pin lifts: drag it or tap where it goes, then Done; × puts it back) and Delete. Delete asks for a second tap. Tap outside or press Escape to close the menu. There is no GPS or automatic underground tracking.
- **Resume:** reopening the app restores the last map and its center, zoom and rotation. Going home retains each map's camera but opens the library on the next launch.
- **Rotation lock:** map rotation is locked by default; dragging and zooming always work. Tapping **Lock** in the bottom pill enables two-finger twist and shows a rotation slider with 15° buttons in View; set the slider to 0° for north up.

**Phone orientation is separate from map rotation.** The app does not control the phone's screen orientation; use your phone's own rotation lock for that. **Lock** only controls map rotation.

Notes, routes, camera and display settings are saved locally in a separate IndexedDB store. Camera writes are throttled and flushed on home, visibility changes and pagehide. Abrupt OS termination can still lose the latest uncommitted change. See [validation.md](docs/validation.md) for the physical-device acceptance checklist.

## Sharing maps and annotations

Use a map's **Share** icon in the library, **Saved → Share map or selected items** in the viewer, or a place/route's **⋯ → Share**. Choose annotations, optionally include the original map image, and send the `.megamap` file through the device's share sheet or **Save file**. The export shows its size before sending.

Friends use **Import → Shared file** in the library to review the file and choose a matching existing map or a separate copy. Exact image fingerprints identify matching maps even after renaming; other images are not offered as destinations. On a matching map, **Merge** keeps local places and routes and adds new shared items, while **Replace** swaps places and finished routes after showing a warning. Annotation-only files require a matching local map or the exact original image to create a new copy. **Import → New map** opens the image picker. On a computer, either kind of file can also be dropped onto the library.

Received items are independently editable. Reimporting skips previously imported items, preserves edits and deletions, and adds new items. Export/import work offline without accounts or a sharing server. See [sharing.md](docs/sharing.md) for the format and verification limits.

## Test

```sh
npm test
npm run build
npm run fixtures                           # 1k, 4k, 9k, 15k PNGs; Python stdlib
npm run benchmark -- fixtures/map-9000.png
npm run benchmark -- fixtures/map-15000.png
```

For JPEG and denser fixtures, use Pillow **only on the development machine**:

```sh
python3 -m venv /tmp/map-viewer-fixtures
/tmp/map-viewer-fixtures/bin/pip install Pillow
/tmp/map-viewer-fixtures/bin/python scripts/generate-fixtures.py --jpeg --sizes 1000 4000 9000
/tmp/map-viewer-fixtures/bin/python scripts/generate-detail-fixture.py
npm run benchmark -- fixtures/map-9000-detail-progressive.jpg
```

Fixture generation intentionally allocates large host images for JPEG encoding. It is not application code. The PNG-only generator streams rows and has no dependencies. Large fixtures are excluded from source control.

The benchmark runs production JPEG/PNG scanline decoding, the full tile pyramid, pixel checks at edges/interior, and cleanup through a Node filesystem/native-canvas adapter. Run one file per process for comparable process-memory measurements. Recorded results and their limits are in [validation.md](docs/validation.md). These tests do **not** claim real Safari memory, GPU, FPS, installation, or touch-device validation.

For device profiling, `window.MapViewer.diagnostics()` reports decoded tile bytes, display canvas bytes, queued tiles, zoom, rendered frames, and average interval of active frames. `window.MapViewer.library()` includes import duration, tile bytes, and decoder. Use remote Safari/Chrome profiling for actual process memory and frame pacing; JavaScript heap size alone misses native allocations.

## Current limits

- Maximum: 256 MiB original, 300 megapixels, 32,768 pixels per side. Wider inputs would need a different band layout.
- WebP and interlaced PNG use the native decoder and are limited to 16 megapixels. Large maps must currently be JPEG or **non-interlaced** PNG.
- Without worker OPFS synchronous handles, the IndexedDB fallback supports baseline JPEG originals up to 64 MiB and progressive JPEG up to 4 MP. Streaming PNG still supports large maps. Large progressive JPEG needs OPFS.
- JPEG EXIF rotation must already be applied to the pixels. Non-standard/12-bit JPEG, animations, PDF, TIFF, and future features are not supported.
- Pixels become display-oriented RGBA8. Embedded ICC profiles, PNG gamma and high-bit-depth fidelity are not handled by the streaming decoders.
- Lossless tile storage can substantially exceed original size. A detailed 27.4 MiB JPEG used 168.4 MiB of tiles plus temporary coefficient files of 232.2 MiB during processing. A quota preflight is only an estimate; actual quota errors are handled and rolled back.
- Import must remain in the foreground until complete. Mobile browsers can suspend workers or kill a PWA in the background. Interrupted work is cleaned up at next launch rather than resumed.
- Browser storage is origin-local. `persist()` is requested but can be refused. Clearing website data, storage eviction, or uninstall behavior can remove imported maps; keep your source files. HTTPS, hostname, and port changes create a different library.
- The shell is precached atomically, including the worker and WASM. A new worker activates after installation; **Update app** reloads the current page after verifying the shell and saving pending changes. Deployment currently assumes the origin root, not a subdirectory.
- Real iOS/Android installation, Airplane Mode cold launch, process-memory ceilings, and sustained touch FPS still require physical-device validation.
- Screen orientation is left to the phone; map rotation locking is application-controlled. Places and routes are manually entered, without positioning sensors, pathfinding or scale calibration.

## Next improvement

Profile the existing pipeline on a real iPhone with the 9k detailed progressive JPEG and 15k PNG before increasing format support. Use those results to tune band/cache budgets and tile encoding. Then add a streaming WebP/Adam7 PNG decoder so every supported input format can use the same bounded-memory import path.

## Rebuild the JPEG codec (optional)

The generated codec is included, so normal development needs no C toolchain. With Emscripten 4.0.16, CMake, and Git available:

```sh
./scripts/build-codec.sh
npm run build
```

The script pins libjpeg-turbo 3.1.2. The source wrappers are in `native/`; licensing is included in `public/codecs/LICENSE-libjpeg.txt`. OCR uses Tesseract.js and ONNX Runtime Web; the canvas and IndexedDB adapters are test-only development dependencies.

### OCR performance check

Run `npm run benchmark:ocr` to time concurrent engine startup, the real local detector/recognizer, and overlapping tile assembly against accuracy fixtures. The initial region-first change was about six times faster than the 24-angle sweep. The five further optimizations reduced the main fixture by another 40% (461 → 277 ms, median of three runs), with all tested labels retained, including 14–16 px text. See [initial results](docs/ocr-benchmark-results.json) and [combined optimization results](docs/ocr-optimization-results.json). These are desktop synthetic measurements, not phone timings. The fast model and smaller detector input can reduce accuracy on other maps; the 4 MiB tile cache adds bounded decoded memory. The detector/runtime adds about 19 MB to the cached shell and increases inference memory; physical-device checks remain pending. Existing indexes remain valid; rerun detection in Advanced settings to use the new pipeline.
