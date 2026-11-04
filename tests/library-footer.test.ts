import test from "node:test";
import assert from "node:assert/strict";
import { $, document, flushSync, render, settle, window } from "./dom";
import { checkAppReachability } from "../src/ui/library-footer";
import LibraryFooter from "../src/ui/LibraryFooter.svelte";

test("live availability requires a fresh response identifying MegaMaps", async () => {
  assert.equal(await checkAppReachability(true, async (url, options) => {
    assert.match(String(url), /^\/app-status\.json\?check=\d+$/);
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json({ app: "mega-maps" });
  }), true);
  assert.equal(await checkAppReachability(true, async () => Response.json({ app: "other" })), false);
  assert.equal(await checkAppReachability(true, async () => new Response("<html>Captive portal</html>")), false);
  assert.equal(await checkAppReachability(true, async () => new Response("Unavailable", { status: 503 })), false);
});

test("offline and failed requests never report the live app as available", async () => {
  let requests = 0;
  const failedRequest: typeof fetch = async () => {
    requests++;
    throw new TypeError("Network unavailable");
  };
  assert.equal(await checkAppReachability(false, failedRequest), false);
  assert.equal(requests, 0);
  assert.equal(await checkAppReachability(true, failedRequest), false);
  assert.equal(requests, 1);
});

/** The app's globals swapped for the length of a test: the browser, its network and the release stamp. */
function stub(t: test.TestContext, globals: { navigator: object; fetch: typeof fetch }) {
  for (const [name, value] of Object.entries(globals)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => {
      if (before) Object.defineProperty(globalThis, name, before);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const meta = document.createElement("meta");
  meta.name = "app-built-at";
  meta.content = new Date(2026, 9, 8, 7, 5).toISOString();
  document.head.append(meta);
  t.after(() => meta.remove());
  // No real polling.
  t.mock.timers.enable({ apis: ["setInterval"] });
}

test("footer reports offline use and connection separately and stamps the loaded release as dd/mm hh:mm", async (t) => {
  let cached = true;
  let reachable = true;
  const browser = {
    onLine: false,
    serviceWorker: Object.assign(new EventTarget(), {
      async getRegistration() { return undefined; },
      controller: {
        postMessage(_message: unknown, ports: MessagePort[]) {
          ports[0]?.postMessage({ ready: cached, missing: [] });
        },
      },
    }),
  };
  let requests = 0;
  stub(t, { navigator: browser, fetch: async () => {
    requests++;
    if (!reachable) throw new TypeError("Host unavailable");
    return Response.json({ app: "mega-maps" });
  } });
  const { instance, destroy } = render(LibraryFooter, {});
  t.after(destroy);
  const refresh = async () => {
    await instance.refresh();
    flushSync();
  };
  const read = () => [
    $("internet-status").dataset.state,
    $("#internet-status strong").textContent,
    $("offline-availability").dataset.state,
    $("offline-availability").textContent,
  ];
  await refresh();
  assert.deepEqual(read(), ["idle", "Offline", "available", "Offline ready"]);
  assert.equal($("app-updated-at").textContent, "08/10 07:05");

  browser.onLine = true;
  cached = false;
  await refresh();
  assert.deepEqual(read(), ["available", "Online", "unavailable", "Not saved offline"]);

  reachable = false;
  cached = true;
  await refresh();
  assert.deepEqual(read(), ["idle", "Offline", "available", "Offline ready"]);

  // While a map is open the footer is hidden: connection changes wait.
  destroy();
  const hidden = render(LibraryFooter, { shown: false });
  t.after(hidden.destroy);
  await settle();
  const before = requests;
  window.dispatchEvent(new window.Event("online"));
  await settle();
  assert.equal(requests, before);
  hidden.destroy();
  const shown = render(LibraryFooter, {});
  t.after(shown.destroy);
  await settle();
  const mounted = requests;
  window.dispatchEvent(new window.Event("online"));
  await settle();
  assert.equal(requests, mounted + 1);
});

test("footer swaps the release stamp for a ready update only when the live site says so", async (t) => {
  const browser = { onLine: true, serviceWorker: undefined };
  stub(t, { navigator: browser, fetch: async () => {
    if (!browser.onLine) throw new TypeError("Network unavailable");
    return Response.json({ app: "mega-maps" });
  } });
  let latest: boolean | Error = true;
  let checks = 0;
  const { instance, destroy } = render(LibraryFooter, { findUpdate: async () => {
    checks++;
    if (latest instanceof Error) throw latest;
    return latest;
  } });
  t.after(destroy);
  await settle();
  checks = 0;
  const refresh = async () => {
    await instance.refresh();
    flushSync();
  };
  const read = () => [
    $("app-update-status").dataset.state,
    $("#app-update-status strong").textContent,
    $("update-hint").textContent,
  ];
  await refresh();
  assert.deepEqual(read(), ["ready", "Update ready", "Tap to install"]);

  // Offline or a failed check can't tell, so the last answer stays.
  browser.onLine = false;
  await refresh();
  assert.equal(checks, 1);
  browser.onLine = true;
  latest = new Error("Host unavailable");
  await refresh();
  assert.deepEqual(read(), ["ready", "Update ready", "Tap to install"]);

  latest = false;
  await refresh();
  assert.deepEqual(read(), ["", "08/10 07:05", "Last update"]);
});
