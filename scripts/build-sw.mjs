import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
const html = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", html.replace("__APP_BUILT_AT__", builtAt));
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
// Open windows show download progress while a new version installs.
let loaded = 0, reported = 0;
async function report(force) {
  if (!force && Date.now() - reported < 150) return;
  reported = Date.now();
  const message = { type: 'install-progress', version: CACHE, loaded: Math.min(loaded, SIZE), total: SIZE };
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
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return [url, new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers })];
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch everything before writing anything, so installation stays atomic.
    loaded = 0;
    await report(true);
    const responses = await Promise.all(ASSETS.map(download));
    await report(true);
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    // Take over immediately: a broken older worker must not keep serving pages.
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('map-viewer-shell-') && key !== CACHE) await caches.delete(key);
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
  }
});
`;
const hash = createHash("sha256").update(worker);
for (const path of shellPaths.sort()) hash.update(await readFile(path));
const cacheName = `map-viewer-shell-${hash.digest("hex").slice(0, 16)}`;
// Stamp the loaded HTML too: an open page can be older than its active worker.
const stampedHtml = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", stampedHtml.replace("__APP_BUILD__", cacheName));
// Sizes are taken after stamping so progress matches the bytes actually served.
let size = 0;
for (const path of shellPaths) size += (await stat(path)).size;
await writeFile(
  "dist/sw.js",
  `
const CACHE = ${JSON.stringify(cacheName)};
const SIZE = ${size};
const ASSETS = ${JSON.stringify(urls)};${worker}`,
);
// Lets the app describe an available update before downloading it.
await writeFile("dist/app-version.json", JSON.stringify({ version: cacheName, size, builtAt }));
console.log(`Offline shell: ${urls.length} assets, ${(size / 1048576).toFixed(1)} MB, ${cacheName}`);
