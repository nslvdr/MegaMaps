import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { checkAppReachability, initLibraryFooter } from "../src/ui/library-footer";

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

test("footer reports live and offline availability independently and keeps the loaded release date", async () => {
  const { window, document } = parseHTML(`<html><head><meta name="app-built-at" content="2026-10-08T10:30:00Z"></head><body><main id="home"><time id="app-updated-at"></time><span id="internet-status"></span><span id="app-availability"></span><span id="offline-availability"></span></main></body></html>`);
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
  const names = ["document", "window", "navigator", "fetch"] as const;
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  // Use DOM events without starting real polling or opening a browser.
  Object.defineProperty(window, "setInterval", { value: () => 0, configurable: true });
  let requests = 0;
  const globals = { document, window, navigator: browser, fetch: async () => {
    requests++;
    if (!reachable) throw new TypeError("Host unavailable");
    return Response.json({ app: "mega-maps" });
  } };
  for (const name of names)
    Object.defineProperty(globalThis, name, { value: globals[name], configurable: true });
  try {
    const home = document.querySelector<HTMLElement>("#home")!;
    const refresh = initLibraryFooter(home);
    const text = (id: string) => document.getElementById(id)!.textContent;
    await refresh();
    assert.equal(text("internet-status"), "No internet");
    assert.equal(text("app-availability"), "Live app unavailable");
    assert.equal(text("offline-availability"), "Available offline");
    assert.equal(document.querySelector<HTMLTimeElement>("time")!.dateTime, "2026-10-08T10:30:00.000Z");

    browser.onLine = true;
    cached = false;
    await refresh();
    assert.equal(text("internet-status"), "Internet connected");
    assert.equal(text("app-availability"), "Live app available");
    assert.equal(text("offline-availability"), "Unavailable offline");

    reachable = false;
    cached = true;
    await refresh();
    assert.equal(text("internet-status"), "Internet unconfirmed");
    assert.equal(text("app-availability"), "Live app unavailable");
    assert.equal(text("offline-availability"), "Available offline");

    // While a map is open the footer is hidden: connection changes wait.
    home.hidden = true;
    const before = requests;
    window.dispatchEvent(new window.Event("online"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, before);
    home.hidden = false;
    window.dispatchEvent(new window.Event("online"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, before + 1);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
