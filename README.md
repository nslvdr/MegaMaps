# Mega Maps

Mobile-first, offline PWA for exploring very large map images of quarries and man-made caves. Everything stays on the device: no accounts, backend, external fonts or runtime CDN. The only network traffic is app updates and PostHog usage counts (`src/stats.ts`), which carry the device type and the Settings nickname.

See [architecture.md](docs/architecture.md) for design decisions the code doesn't explain.

## Commands

```sh
npm run dev          # http://localhost:5173, no service worker
npm run build && npm run preview   # http://localhost:4173, production shell with offline support
npm test
npm run deploy       # Cloudflare Worker serving dist/ (needs `npx wrangler login` once)
npm run build:dev    # the dev site: "Mega Maps Dev", orange icons, no stats
npm run fixtures     # 1k–15k PNG fixtures (Python stdlib); large fixtures are git-ignored
npm run benchmark -- fixtures/map-9000.png   # one file per process for comparable memory numbers
npm run benchmark:ocr -- [workers]           # OCR recall on a synthetic 170-label sheet
```

JPEG and dense fixtures need Pillow in a throwaway venv (`scripts/generate-fixtures.py --jpeg`, `scripts/generate-detail-fixture.py`). Never add Pillow or host-side image allocation to app code.

## Dev site

Cloudflare builds `main` into the released app at `mega-maps.fr`, and the `dev` branch into a second Worker, `mega-maps-dev`, at `dev.mega-maps.fr` (`npm run build:dev`, then `npx wrangler deploy --env dev`). It is another origin, so it installs as a separate app with its own maps, and a broken build there can't reach the released app. Run `npm run icons` after changing `public/icons/icon.svg` or `assets/dev-icons/icon.svg`.

## Dev gotchas

- Browser storage belongs to the origin, so every port or worktree starts with an empty library. A dev server restores the `.megabackup` files in `~/.megamaps-dev/` (or `MEGAMAPS_DEV_DATA`) that its origin is missing.
- A phone on a LAN `http://` address is not a secure context, so service workers and OPFS don't work. Use `MAP_VIEWER_HTTPS_CERT` and `MAP_VIEWER_HTTPS_KEY` with `npm run preview`, with a certificate the phone trusts.
- Targets: Safari/iOS 17+ and current Android Chrome. Deployment assumes the origin root, not a subdirectory.
- The JPEG codec in `public/codecs/` is generated. Rebuilding it with `scripts/build-codec.sh` needs Emscripten 4.0.16 and CMake, and pins libjpeg-turbo 3.1.2.
- Automated tests run in Node with DOM and canvas adapters. They don't measure Safari memory, GPU use, FPS, installation or touch behaviour; those still need a real device.
