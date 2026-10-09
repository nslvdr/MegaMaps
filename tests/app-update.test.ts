import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { findAppUpdate, installAppUpdate, type DownloadProgress } from "../src/app-update";

class Worker extends EventTarget {
  state: ServiceWorkerState = "activated";
  ready = true;
  skipRequested = false;
  constructor(readonly version: string) { super(); }
  postMessage(message: { type: string }, ports?: MessagePort[]) {
    if (message.type === "skip-waiting") this.skipRequested = true;
    if (message.type === "verify-shell")
      ports?.[0]?.postMessage({ ready: this.ready, version: this.version });
  }
  transition(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function environment(worker: Worker, update = async () => {}) {
  const container = Object.assign(new EventTarget(), {
    controller: worker as Worker | null,
    async register(url: string, options: RegistrationOptions) {
      assert.equal(url, "/sw.js");
      assert.equal(options.updateViaCache, "none");
      return registration;
    },
    async getRegistration() {
      return registration;
    },
  });
  const registration = {
    active: worker as Worker | null,
    installing: null as Worker | null,
    waiting: null as Worker | null,
    update,
  };
  return {
    container,
    registration,
    check: (loaded: string, progress?: (progress: DownloadProgress) => void) =>
      installAppUpdate(loaded, progress, container as unknown as ServiceWorkerContainer),
    find: (loaded: string, latest: unknown, ok = true) =>
      findAppUpdate(loaded, container as unknown as ServiceWorkerContainer, async (url) => {
        assert.match(String(url), /^\/app-version\.json\?check=/);
        return new Response(JSON.stringify(latest), { status: ok ? 200 : 404 });
      }),
  };
}

test("update detects both an already current page and an older page with a newer active worker", async () => {
  const app = environment(new Worker("build-two"));
  assert.equal(await app.check("build-two"), false);
  assert.equal(await app.check("build-one"), true);
});

test("update waits for installation and page control before permitting a reload", async () => {
  const worker = new Worker("new");
  worker.state = "installing";
  const app = environment(worker);
  app.container.controller = new Worker("old");
  app.registration.installing = worker;
  let finished = false;
  const pending = app.check("old").then((result) => { finished = true; return result; });
  await setImmediate();
  assert.equal(finished, false);
  worker.transition("installed");
  assert.equal(worker.skipRequested, true);
  worker.transition("activated");
  await setImmediate();
  assert.equal(finished, false, "activation alone is not enough");
  app.container.controller = worker;
  app.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(await pending, true);
});

test("offline checks, failed installs and incomplete shells fail without requesting a reload", async () => {
  const offline = environment(new Worker("old"), async () => { throw new Error("Offline"); });
  await assert.rejects(offline.check("old"), /Offline/);
  const failed = new Worker("new");
  failed.state = "redundant";
  await assert.rejects(environment(failed).check("old"), /could not be installed/);
  const incomplete = new Worker("new");
  incomplete.ready = false;
  await assert.rejects(environment(incomplete).check("old"), /not ready for offline use/);
});

test("finding an update reports size and release without installing anything", async () => {
  const app = environment(new Worker("build-one"));
  app.registration.update = async () => assert.fail("finding must not start a download");
  assert.equal(await app.find("build-two", { version: "build-two", size: 10 }), undefined);
  const update = await app.find("build-one", { version: "build-two", size: 2048, builtAt: "2026-10-01T10:00:00.000Z" });
  assert.deepEqual(update, {
    version: "build-two",
    size: 2048,
    releasedAt: new Date("2026-10-01T10:00:00.000Z"),
    downloaded: false,
  });
});

test("finding an update notices when the background worker already downloaded it", async () => {
  const app = environment(new Worker("build-two"));
  const update = await app.find("build-one", { version: "build-two", size: 2048 });
  assert.equal(update?.downloaded, true);
});

test("finding an update fails clearly when the host is unreachable or unreadable", async () => {
  const app = environment(new Worker("build-one"));
  await assert.rejects(app.find("build-one", {}, false), /latest version/);
  const offline = findAppUpdate("build-one", app.container as unknown as ServiceWorkerContainer, async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(offline, /Couldn’t reach Mega Maps/);
});

test("installing forwards download progress from the new worker", async () => {
  const worker = new Worker("new");
  worker.state = "installing";
  const app = environment(worker);
  app.container.controller = new Worker("old");
  app.registration.installing = worker;
  const seen: DownloadProgress[] = [];
  const pending = app.check("old", (progress) => seen.push(progress));
  await setImmediate();
  app.container.dispatchEvent(new MessageEvent("message", { data: { type: "install-progress", loaded: 5, total: 10 } }));
  app.container.dispatchEvent(new MessageEvent("message", { data: { type: "other" } }));
  app.container.dispatchEvent(new MessageEvent("message", { data: { type: "install-progress", loaded: 10, total: 10 } }));
  worker.transition("activated");
  app.container.controller = worker;
  app.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(await pending, true);
  assert.deepEqual(seen, [{ loaded: 5, total: 10 }, { loaded: 10, total: 10 }]);
});
