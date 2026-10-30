import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`,
      ),
    )
  ).flat();
}
// The footer shows the release date of the loaded build, including offline.
const builtAt = new Date().toISOString();
// A readable name for people and stats, e.g. 2026.10.30-1432-13c17c2 (UTC time and
// commit); the content hash below stays the identity that updates compare.
const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}
};
const commit = git("rev-parse", "--short", "HEAD");
const release = [
  `${builtAt.slice(0, 10).replaceAll("-", ".")}-${builtAt.slice(11, 13)}${builtAt.slice(14, 16)}`,
  ...(commit ? [commit] : []),
  ...(commit && git("status", "--porcelain") ? ["dirty"] : []),
].join("-");
const html = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", html.replace("__APP_BUILT_AT__", builtAt).replace("__APP_RELEASE__", release));
const paths = (await files("dist")).filter((p) => !p.endsWith("/sw.js"));
// The availability and version probes must always reach the host, never the offline cache.
const live = ["/app-status.json", "/app-version.json"];
const shellPaths = paths.filter((p) => !live.some((url) => p.endsWith(url)));
const urls = shellPaths.map((p) => `/${p.slice(5)}`);
// Hosts with pretty URLs (Cloudflare assets, Netlify…) redirect /index.html to /.
// Safari refuses to open a page from a service-worker response that was
// redirected, so the shell is fetched from / and every cached response is
// stored as a fresh, redirect-free copy.
const worker = `
const SHELL = '/index.html';
const source = url => url === SHELL ? '/' : url;
async function clean(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
// Open windows show download progress while a new version installs; only
// bytes that actually download count.
let loaded = 0, total = 0, reported = 0;
async function report(force) {
  if (!force && Date.now() - reported < 150) return;
  reported = Date.now();
  const message = { type: 'install-progress', version: CACHE, loaded: Math.min(loaded, total), total };
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage(message);
}
// Read bodies chunk by chunk to count bytes; the stored copy is decoded and redirect-free.
async function download(url) {
  const response = await fetch(source(url), { cache: 'reload' });
  if (!response.ok) throw new Error('Could not cache ' + url + ': ' + response.status);
  const chunks = [];
  const reader = response.body?.getReader();
  for (let part = await reader?.read(); part && !part.done; part = await reader.read()) {
    chunks.push(part.value);
    loaded += part.value.byteLength;
    void report(false);
  }
  return stored(response, new Blob(chunks), url);
}
function stored(response, blob, url) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('x-shell-hash', FILES[url].hash);
  return new Response(blob, { status: response.status, statusText: response.statusText, headers });
}
async function sha256(blob) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
// Most updates change a few small files, while the OCR models and runtime
// stay the same. A file an earlier version already holds is copied only when
// its bytes hash to this build's; anything else, or any error, downloads.
async function kept(url, earlier) {
  const { hash, size } = FILES[url];
  for (const name of earlier) {
    try {
      const response = await (await caches.open(name)).match(url);
      if (!response?.ok) continue;
      const blob = await response.blob();
      if (blob.size === size && (await sha256(blob)) === hash) return stored(response, blob, url);
    } catch {}
  }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch everything before writing anything, so installation stays atomic.
    // Until the files to download are known, nothing counts as loaded, which
    // windows read as starting; it still shows the update is alive.
    loaded = total = 0;
    await report(true);
    const earlier = (await caches.keys().catch(() => []))
      .filter(name => name.startsWith('map-viewer-shell-') && name !== CACHE);
    const reused = new Map();
    for (const url of ASSETS) {
      const response = await kept(url, earlier);
      if (response) reused.set(url, response);
      void report(false);
    }
    total = ASSETS.reduce((sum, url) => sum + (reused.has(url) ? 0 : FILES[url].size), 0);
    await report(true);
    const responses = await Promise.all(ASSETS.map(async url => [url, reused.get(url) ?? await download(url)]));
    await report(true);
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    // Take over immediately: a broken older worker must not keep serving pages.
    await self.skipWaiting();
  })());
});
// A page opened before an update keeps running and may still start its own
// workers, whose hashed files this version renamed. The version just before
// keeps only those files, until the next update; older versions go.
function earlierShells(keys) {
  return keys.filter(name => name.startsWith('map-viewer-shell-') && name !== CACHE);
}
async function keepRenamed(name) {
  try {
    const cache = await caches.open(name);
    let left = 0;
    for (const request of await cache.keys()) {
      const path = new URL(request.url, self.location.origin).pathname;
      if (path.startsWith('/assets/') && !ASSETS.includes(path)) left++;
      else await cache.delete(request);
    }
    if (left) return;
  } catch {}
  await caches.delete(name);
}
async function renamedAsset(path) {
  for (const name of earlierShells(await caches.keys())) {
    const response = await (await caches.open(name)).match(path);
    if (response) return response;
  }
}
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Caches list in the order they were made, so the last is the version just before.
    const earlier = earlierShells(await caches.keys());
    const previous = earlier.pop();
    for (const key of earlier) await caches.delete(key);
    if (previous) await keepRenamed(previous);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'skip-waiting') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== 'verify-shell' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const missing = [];
      for (const url of ASSETS) {
        const response = await cache.match(url);
        if (!response || !(await response.arrayBuffer()).byteLength) missing.push(url);
      }
      event.ports[0].postMessage({ ready: missing.length === 0, missing, assets: ASSETS.length, version: CACHE });
    } catch { event.ports[0].postMessage({ ready: false, missing: ['Application shell'] }); }
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(SHELL)).then(response => response ? clean(response) : fetch(request)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || fetch(request)));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(renamedAsset(url.pathname).catch(() => undefined).then(response => response || fetch(request)));
  }
});
`;
const hash = createHash("sha256").update(worker);
for (const path of shellPaths.sort()) hash.update(await readFile(path));
const cacheName = `map-viewer-shell-${hash.digest("hex").slice(0, 16)}`;
// Stamp the loaded HTML too: an open page can be older than its active worker.
const stampedHtml = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", stampedHtml.replace("__APP_BUILD__", cacheName));
// Sizes and hashes are taken after stamping so they match the bytes actually served.
const shellFiles = {};
for (const path of shellPaths) {
  const bytes = await readFile(path);
  shellFiles[`/${path.slice(5)}`] = { hash: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
}
const size = Object.values(shellFiles).reduce((sum, file) => sum + file.size, 0);
await writeFile(
  "dist/sw.js",
  `
const CACHE = ${JSON.stringify(cacheName)};
const SIZE = ${size};
const ASSETS = ${JSON.stringify(urls)};
const FILES = ${JSON.stringify(shellFiles)};${worker}`,
);
// Lets the app describe an available update before downloading it.
// Files list each hash, so the app can tell how much an update really downloads.
await writeFile("dist/app-version.json", JSON.stringify({ version: cacheName, size, builtAt, files: shellFiles }));
console.log(`Offline shell: ${urls.length} assets, ${(size / 1048576).toFixed(1)} MB, ${release} (${cacheName})`);
