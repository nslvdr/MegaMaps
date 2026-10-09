import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

test("generated service worker serves cold offline navigation, worker JS, and codec WASM without redirects", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-viewer-sw-"));
  try {
    await mkdir(path.join(root, "dist/assets"), { recursive: true });
    await mkdir(path.join(root, "dist/codecs"));
    await mkdir(path.join(root, "dist/ocr"));
    const assets = {
      "/index.html": '<html><meta name="app-build" content="__APP_BUILD__"><meta name="app-built-at" content="__APP_BUILT_AT__">offline</html>',
      "/assets/import.worker.js": "worker",
      "/codecs/jpeg.js": "decoder",
      "/codecs/jpeg.wasm": "wasm",
      "/ocr/worker.min.js": "ocr worker",
      "/ocr/tesseract-core-lstm.wasm.js": "ocr wasm",
      "/ocr/eng.traineddata.gz": "ocr model",
      "/ocr/ort-wasm-simd-threaded.mjs": "detector runtime module",
      "/ocr/ort-wasm-simd-threaded.wasm": "detector runtime wasm",
      "/ocr/pp-ocrv5-mobile-det.onnx": "text detector model",
      "/manifest.webmanifest": "{}",
      "/app-status.json": '{"app":"mega-maps"}',
    };
    for (const [name, contents] of Object.entries(assets))
      await writeFile(path.join(root, "dist", name), contents);
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/build-sw.mjs", import.meta.url))],
      { cwd: root },
    );
    const script = await readFile(path.join(root, "dist/sw.js"), "utf8");
    assets["/index.html"] = await readFile(
      path.join(root, "dist/index.html"),
      "utf8",
    );
    assert.ok(!assets["/index.html"].includes("__APP_BUILD__"));
    const builtAt = assets["/index.html"].match(
      /name="app-built-at" content="([^"]+)"/,
    )?.[1];
    assert.ok(builtAt && Number.isFinite(new Date(builtAt).getTime()));
    const listeners = new Map<string, (event: unknown) => void>();
    const stores = new Map<string, Map<string, Response>>();
    let network = 0,
      online = true,
      claimed = false,
      skipped = false;
    const fetched: string[] = [];
    const progress: { type: string; loaded: number; total: number; version: string }[] = [];
    const caches = {
      async open(name: string) {
        let data = stores.get(name);
        if (!data) {
          data = new Map();
          stores.set(name, data);
        }
        return {
          async put(url: string, response: Response) {
            assert.ok(url in assets);
            data!.set(url, response);
          },
          async match(url: string) {
            return data!.get(url)?.clone();
          },
        };
      },
      async keys() {
        return [...stores.keys()];
      },
      async delete(name: string) {
        return stores.delete(name);
      },
    };
    runInNewContext(script, {
      caches,
      URL,
      Response,
      Headers,
      Blob,
      // Like Cloudflare assets: /index.html redirects to /, which serves the shell.
      fetch: async (url: string) => {
        network++;
        if (!online) throw new Error("Offline");
        fetched.push(url);
        assert.notEqual(url, "/index.html", "the shell is fetched from /");
        const body = url === "/" ? assets["/index.html"] : assets[url as keyof typeof assets];
        assert.ok(body !== undefined, url);
        const response = new Response(body);
        if (url === "/") Object.defineProperty(response, "redirected", { value: true });
        return response;
      },
      self: {
        location: { origin: "https://map.local" },
        async skipWaiting() {
          skipped = true;
        },
        clients: {
          async claim() {
            claimed = true;
          },
          async matchAll(options: { type: string; includeUncontrolled: boolean }) {
            assert.equal(options.type, "window");
            assert.equal(options.includeUncontrolled, true);
            return [{ postMessage: (message: (typeof progress)[number]) => progress.push(message) }];
          },
        },
        addEventListener: (name: string, listener: (event: unknown) => void) =>
          listeners.set(name, listener),
      },
    });
    async function lifecycle(name: string) {
      let done: Promise<unknown> | undefined;
      listeners.get(name)!({
        waitUntil: (p: Promise<unknown>) => {
          done = p;
        },
      });
      await done;
    }
    await lifecycle("install");
    assert.equal(skipped, true);
    assert.equal(fetched.length, Object.keys(assets).length - 1);
    assert.ok(
      !fetched.includes("/app-status.json"),
      "live availability is never precached",
    );
    // Install progress counts every shell byte and ends complete.
    const shellBytes = Object.entries(assets)
      .filter(([url]) => url !== "/app-status.json")
      .reduce((sum, [, body]) => sum + Buffer.byteLength(body), 0);
    assert.ok(progress.length >= 2);
    assert.ok(progress.every((message) => message.type === "install-progress" && message.total === shellBytes));
    assert.equal(progress[0]!.loaded, 0);
    assert.equal(progress.at(-1)!.loaded, shellBytes);
    // The version probe describes the update before anything downloads.
    const version = JSON.parse(await readFile(path.join(root, "dist/app-version.json"), "utf8"));
    assert.equal(version.size, shellBytes);
    assert.equal(version.builtAt, builtAt);
    assert.ok(assets["/index.html"].includes(`content="${version.version}"`));
    assert.equal(progress[0]!.version, version.version);
    let intercepted = false;
    listeners.get("fetch")!({
      request: {
        url: "https://map.local/app-status.json?check=123",
        method: "GET",
        mode: "cors",
      },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(
      intercepted,
      false,
      "availability probes go straight to the network",
    );
    listeners.get("fetch")!({
      request: {
        url: "https://map.local/app-version.json?check=123",
        method: "GET",
        mode: "cors",
      },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, "version probes go straight to the network");
    stores.set("map-viewer-shell-old", new Map());
    stores.set(
      "unrelated-user-cache",
      new Map([["saved", new Response("keep me")]]),
    );
    await lifecycle("activate");
    assert.equal(claimed, true);
    assert.equal(stores.has("map-viewer-shell-old"), false);
    assert.equal(
      await stores.get("unrelated-user-cache")!.get("saved")!.text(),
      "keep me",
    );
    online = false;
    network = 0;
    // An older worker may still hold a redirected shell: it must be cleaned.
    const redirected = new Response(assets["/index.html"]);
    Object.defineProperty(redirected, "redirected", { value: true });
    stores.values().next().value!.set("/index.html", redirected);
    async function request(url: string, mode: string) {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")!({
        request: { url: `https://map.local${url}`, method: "GET", mode },
        respondWith: (p: Promise<Response>) => {
          response = p;
        },
      });
      assert.ok(response);
      const result = await response!;
      // Safari refuses navigations answered with a redirected response.
      assert.equal(result.redirected, false, url);
      return result.text();
    }
    assert.equal(
      await request("/?cold-start", "navigate"),
      assets["/index.html"],
    );
    for (const url of [
      "/assets/import.worker.js",
      "/codecs/jpeg.js",
      "/codecs/jpeg.wasm",
      "/ocr/worker.min.js",
      "/ocr/tesseract-core-lstm.wasm.js",
      "/ocr/eng.traineddata.gz",
      "/ocr/ort-wasm-simd-threaded.mjs",
      "/ocr/ort-wasm-simd-threaded.wasm",
      "/ocr/pp-ocrv5-mobile-det.onnx",
    ])
      assert.equal(
        await request(url, "cors"),
        assets[url as keyof typeof assets],
      );
    assert.equal(network, 0);
    async function checkShell() {
      let done: Promise<unknown> | undefined;
      let result:
        | { ready: boolean; missing: string[]; version: string }
        | undefined;
      listeners.get("message")!({
        data: { type: "verify-shell" },
        ports: [
          {
            postMessage: (value: {
              ready: boolean;
              missing: string[];
              version: string;
            }) => {
              result = value;
            },
          },
        ],
        waitUntil: (value: Promise<unknown>) => {
          done = value;
        },
      });
      await done;
      return result!;
    }
    assert.equal((await checkShell()).ready, true);
    assert.ok(
      assets["/index.html"].includes(
        `content="${(await checkShell()).version}"`,
      ),
    );
    stores.values().next().value!.delete("/codecs/jpeg.wasm");
    assert.deepEqual(
      Array.from((await checkShell()).missing, (value) => String(value)),
      ["/codecs/jpeg.wasm"],
    );
    assert.equal((await checkShell()).ready, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
