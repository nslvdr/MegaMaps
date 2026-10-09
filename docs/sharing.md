# File sharing

MegaMaps exchanges independent, editable copies through `.megamap` files. Export and import work locally and offline. Sending the file uses the device's share sheet or a downloaded file; the chosen messaging app handles delivery.

## Send

- In the library, tap a map's **Share** icon. In the viewer, use **Saved → Share map or selected items**.
- A place or finished route's **⋯ → Share** starts with only that item selected.
- Select any combination of places and finished routes. Place notes are included. **Select all** and **Clear selection** change the annotation selection.
- **Include map image** adds the original JPEG, PNG, or WebP, without its generated tiles. Image-only exports are supported. The dialog shows the total file size before sending.
- **Share file** opens native file sharing when supported. Otherwise it saves the file. **Save file** always downloads it.

## Receive

- Open MegaMaps and choose **Import → Shared file** in the library, then select the `.megamap` file. **Import → New map** opens the image picker. File contents determine the import type if you choose a file through the other picker.
- Review the map name, counts, image inclusion, and destination.
- Choose an existing map or create a separate copy. Without an embedded image, a new copy requires the exact source image supplied through the dialog.
- Exact matches use SHA-256 of the original image bytes; filenames have no effect. A re-encoded image is not an exact match even if its pixels look identical.
- Only existing maps with the same original image fingerprint and pixel dimensions are offered. Maps that merely have the same dimensions cannot receive the shared annotations.
- For a matching map, **Merge** keeps existing places and routes and adds unseen shared items. **Replace** removes existing places and finished routes and uses the shared ones. The dialog shows removal counts and a warning before replacing. Unfinished route drafts, display settings, and camera state are kept.
- New copies verify both image dimensions and the fingerprint before processing. The usual local image importer builds their viewing tiles.
- Import opens the destination map and reports added, skipped, or replaced items.

Each destination remembers imported annotation identities. Repeated merges add new identities, skip existing ones, preserve local edits, and do not resurrect deleted imported items. Replace resets that history to the shared identities, so shared items previously edited or deleted are restored. Display settings and camera state remain local. Changes to a received copy do not automatically reach its sender.

An annotation write reads the latest map and navigation together in one IndexedDB transaction. New-copy failures clean up that copy. Stale camera saves preserve imports that their window has not yet seen. Replace increments a local annotation revision so older saves cannot restore removed places or finished routes; a library-channel notification refreshes annotations in an open viewer.

## Version 1 file format

The binary container is deliberately simple and does not compress or base64-encode an already compressed map image:

1. Eight ASCII bytes: `MEGAMAP1`.
2. Four bytes: unsigned little-endian UTF-8 manifest length.
3. UTF-8 JSON manifest.
4. Optional original image bytes, exactly the length declared in the manifest.

The manifest contains `format: "megamap"`, `version: 1`, map name, original pixel dimensions, lowercase SHA-256 `fingerprint`, arrays of `markers` and finished `routes`, and optional image metadata (`name`, MIME `type`, `bytes`). Items retain their source IDs. Import history uses `marker:<id>` and `route:<id>` keys and is not exported. Map display settings, saved camera, tile cache, and unfinished routes are not part of this version.

Files contain plain annotations and an optional original image. MegaMaps has no sharing server or account system.

Parsing limits are 4 MiB of manifest JSON, 10,000 combined annotations, 100,000 route points, and the existing 256 MiB original-image limit. Imported names, types, counts, timestamps, coordinates, identities, image metadata, and payload lengths are validated. Fingerprinting reads at most 1 MiB at a time; packaging uses Blob parts and parsing slices the optional image without loading it into one ArrayBuffer.

## Verification

`tests/sharing.test.ts` covers both container round trips, header-based import routing, bounded hashing, malformed files, image verification, selection, map matching, duplicate/deletion behavior, merge and replace, atomic concurrent imports, stale saves, and rollback. `tests/sharing-ui.test.ts` uses a DOM adapter to cover selection, safe text rendering, native-share dispatch, matching destinations, merge/replace controls and warnings, double-submit protection, retry, and cancellation. Viewer tests cover map-level and item-level sharing actions.

Physical iPhone/Android verification is still needed for native share-sheet destinations, downloaded-file selection, large-file behavior, and offline import after a cold launch. Automated tests do not establish those device behaviors.
