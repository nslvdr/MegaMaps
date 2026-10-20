import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { checkAppReachability, initLibraryFooter, libraryFooterMarkup } from "../src/ui/library-footer";

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

test("footer reports offline use and connection separately and stamps the loaded release as dd/mm hh:mm", async () => {
  const { window, document } = parseHTML(`<html><head><meta name="app-built-at" content="${new Date(2026, 9, 8, 7, 5).toISOString()}"></head><body><main id="home">${libraryFooterMarkup}</main></body></html>`);
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
    const read = () => [
      document.getElementById("internet-status")!.dataset.state,
      document.querySelector("#internet-status strong")!.textContent,
      document.getElementById("offline-availability")!.dataset.state,
      document.getElementById("offline-availability")!.textContent,
    ];
    await refresh();
    assert.deepEqual(read(), ["idle", "Offline", "available", "Offline ready"]);
    assert.equal(document.querySelector("time")!.textContent, "08/10 07:05");

    browser.onLine = true;
    cached = false;
    await refresh();
    assert.deepEqual(read(), ["available", "Online", "unavailable", "Not saved offline"]);

    reachable = false;
    cached = true;
    await refresh();
    assert.deepEqual(read(), ["idle", "Offline", "available", "Offline ready"]);

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

test("footer swaps the release stamp for a ready update only when the live site says so", async () => {
  const { window, document } = parseHTML(`<html><head><meta name="app-built-at" content="${new Date(2026, 9, 8, 7, 5).toISOString()}"></head><body><main id="home">${libraryFooterMarkup}</main></body></html>`);
  const browser = { onLine: true, serviceWorker: undefined };
  const names = ["document", "window", "navigator", "fetch"] as const;
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.defineProperty(window, "setInterval", { value: () => 0, configurable: true });
  let latest: boolean | Error = true;
  let checks = 0;
  const globals = { document, window, navigator: browser, fetch: async () => {
    if (!browser.onLine) throw new TypeError("Network unavailable");
    return Response.json({ app: "mega-maps" });
  } };
  for (const name of names)
    Object.defineProperty(globalThis, name, { value: globals[name], configurable: true });
  try {
    const refresh = initLibraryFooter(document.querySelector<HTMLElement>("#home")!, async () => {
      checks++;
      if (latest instanceof Error) throw latest;
      return latest;
    });
    const read = () => [
      document.getElementById("app-update-status")!.dataset.state,
      document.querySelector<HTMLElement>("#app-update-status strong > :not([hidden])")!.textContent,
      document.getElementById("update-hint")!.textContent,
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
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
