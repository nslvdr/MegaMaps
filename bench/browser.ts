import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import type { Fixture, Fixtures } from "./fixtures";
import { quantile } from "./stats";
import type { MapRecord } from "../src/types";
import type { Point } from "../src/viewer/camera";

// One version of the app, run as in development: its own vite server and a
// headless Chrome sized like a phone. The bench drives the app's own modules
// and screens, so it times any version without code added to the app.

/** Where vite serves the app's modules, set in the page by FRAME_TIMER. Code
 * run in the page imports them through it; their types come from the files. */
declare const SRC: string;
/** One run's numbers, in milliseconds; lower is better. A number timed by
 * frames moves a frame at a time, its step. */
export type Sample = Record<string, number | { ms: number; step: number }>;
export interface Scenario {
  name: string;
  run(): Promise<Sample>;
}

/** An iPhone's screen: the canvas then has a phone's pixel count. */
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
/** Moving the map runs on a CPU this many times slower, closer to a phone's. */
const PHONE_SLOWDOWN = 4;
/** The map counts as settled once it hasn't repainted for this long. */
const QUIET_MS = 600;
const FRAME_MS = 1000 / 60;

interface BenchWindow {
  __bench: { frames: Map<number, number>; last: number; viewerAt: number };
  MapViewer?: { diagnostics(): { queuedTiles: number } | null };
}

// Times every animation frame's callbacks together, which is where the map
// draws. A plain string, so the page runs it before any of its own scripts.
const FRAME_TIMER = `
globalThis.__name = (target) => target;
globalThis.SRC = "/src/";
(() => {
  const bench = { frames: new Map(), last: 0, viewerAt: 0 };
  globalThis.__bench = bench;
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => request((time) => {
    const start = performance.now();
    try {
      callback(time);
    } finally {
      const end = performance.now();
      bench.frames.set(time, (bench.frames.get(time) ?? 0) + end - start);
      bench.last = end;
      if (!bench.viewerAt && window.MapViewer?.diagnostics?.()) bench.viewerAt = start;
    }
  });
})();`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("No free port for the bench server.");
  return address.port;
}

async function startVite(root: string) {
  const port = await freePort();
  const env = { ...process.env };
  // Plain http: localhost is a secure context already.
  delete env.MAP_VIEWER_HTTPS_CERT;
  delete env.MAP_VIEWER_HTTPS_KEY;
  const server = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--port", `${port}`, "--strictPort"], {
    cwd: root, env, stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  server.stderr?.on("data", (chunk) => (errors += chunk));
  const origin = `http://localhost:${port}`;
  for (const started = Date.now(); Date.now() - started < 60_000; await sleep(200)) {
    if (server.exitCode !== null) throw new Error(`vite stopped in ${root}:\n${errors}`);
    if (await fetch(origin).then((response) => response.ok, () => false)) return { server, origin };
  }
  server.kill();
  throw new Error(`vite did not start in ${root}:\n${errors}`);
}

/** Fingers on the screen, in CSS pixels, through Chrome's own touch input. */
class Fingers {
  constructor(private cdp: CDPSession) {}
  private send(type: "touchStart" | "touchMove" | "touchEnd", points: Point[]) {
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(({ x, y }, id) => ({ x, y, id })) });
  }
  /** Ends at rest, or lifts while still moving so the map flings on. */
  async drag(from: Point, to: Point, steps: number, fling = false) {
    await this.send("touchStart", [from]);
    for (let i = 1; i <= steps; i++) {
      await sleep(16);
      await this.send("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    }
    if (!fling) await sleep(150);
    await this.send("touchEnd", []);
  }
  async pinch(centre: Point, fromGap: number, toGap: number, steps: number) {
    const at = (gap: number) => [{ x: centre.x, y: centre.y - gap / 2 }, { x: centre.x, y: centre.y + gap / 2 }];
    await this.send("touchStart", at(fromGap));
    for (let i = 1; i <= steps; i++) {
      await sleep(16);
      await this.send("touchMove", at(fromGap + ((toGap - fromGap) * i) / steps));
    }
    await sleep(100);
    await this.send("touchEnd", []);
  }
}

export class App {
  private page!: Page;
  private cdp!: CDPSession;
  private mapRecord!: MapRecord;
  private textRecord!: MapRecord;
  private paperRecord?: MapRecord;

  private constructor(
    private server: ChildProcess,
    private origin: string,
    private context: BrowserContext,
    private profile: string,
    private fixtures: Fixtures,
  ) {}

  static async start(root: string, fixtures: Fixtures, headed: boolean) {
    const { server, origin } = await startVite(root);
    const profile = await mkdtemp(join(tmpdir(), "megamaps-bench-"));
    try {
      // A profile on disk, so storage behaves as on a device rather than in memory.
      const context = await chromium.launchPersistentContext(profile, {
        channel: "chrome", headless: !headed, ...PHONE, isMobile: true, hasTouch: true,
      });
      const app = new App(server, origin, context, profile, fixtures);
      await app.prepare();
      return app;
    } catch (error) {
      server.kill();
      await rm(profile, { recursive: true, force: true });
      throw error;
    }
  }

  private async prepare() {
    await this.context.addInitScript(FRAME_TIMER);
    // A blank page on the app's origin, where its modules load without the app starting.
    await this.context.route(`${this.origin}/__bench`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Bench</title>" }));
    const { map, text, paper } = this.fixtures;
    const images = { "map.jpg": map.image, "text.jpg": text.image, "paper.jpg": paper?.image ?? text.image };
    await this.context.route(`${this.origin}/__bench/*.jpg`, (route) =>
      route.fulfill({ path: images[new URL(route.request().url()).pathname.split("/").pop() as keyof typeof images] }));
    // The app restores the dev backup's maps on a new origin; the bench brings its own.
    await this.context.route(`${this.origin}/@dev-data/**`, (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
    await this.openPage();
    await this.blank();
    // A device that has seen the welcome, the tips and this release's news.
    await this.page.evaluate(() => {
      for (const key of ["tour", "hold-tip", "example-offer"]) localStorage.setItem(`megamaps:${key}`, "seen");
      localStorage.setItem("megamaps:changelog-seen", "bench");
    });
    this.mapRecord = await this.importFixture("map.jpg", this.fixtures.map);
    this.textRecord = await this.importFixture("text.jpg", this.fixtures.text);
    if (this.fixtures.paper) this.paperRecord = await this.importFixture("paper.jpg", this.fixtures.paper);
  }

  private async openPage() {
    this.crashed = false;
    this.page = await this.context.newPage();
    this.page.on("pageerror", (error) => console.warn(`  page error: ${error.message}`));
    this.page.on("crash", () => (this.crashed = true));
    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send("Performance.enable");
  }

  /** Whether Chrome crashed the page, as it sometimes does under load. */
  crashed = false;
  /** A new page goes on with the same storage and maps. */
  async recover() {
    await this.page.close().catch(() => {});
    await this.openPage();
  }

  private blank() {
    return this.page.goto(`${this.origin}/__bench`);
  }

  /** Imports a fixture as a map kept for the bench, with its places and names. */
  private importFixture(file: string, fixture: Fixture) {
    return this.page.evaluate(async ({ file, lines }) => {
      const { importMap } = (await import(`${SRC}processing/import.ts`)) as typeof import("../src/processing/import");
      const { saveOcr } = (await import(`${SRC}storage/ocr.ts`)) as typeof import("../src/storage/ocr");
      const { OCR_VERSION } = (await import(`${SRC}ocr/index.ts`)) as typeof import("../src/ocr/index");
      const blob = await (await fetch(`/__bench/${file}`)).blob();
      const map = await importMap(new File([blob], file, { type: "image/jpeg" }), () => {}, new AbortController().signal);
      // Already scanned, so opening it doesn't offer a text scan.
      await saveOcr({ mapId: map.id, version: OCR_VERSION, completedAt: Date.now(), lines });
      return map;
    }, { file, lines: fixture.lines });
  }

  scenarios(): Scenario[] {
    const megapixels = (map: MapRecord) => `${Math.round((map.width * map.height) / 1e6)} MP`;
    return [
      { name: "import", run: async () => ({ [`Import a ${megapixels(this.mapRecord)} map`]: await this.timeImport() }) },
      { name: "text", run: async () => ({ [`Text scan of ${megapixels(this.textRecord)}, all print`]: await this.timeTextScan(this.textRecord) }) },
      ...this.paperScan(megapixels),
      { name: "map", run: () => this.moveMap(true) },
      { name: "map", run: () => this.moveMap(false) },
    ];
  }

  private async timeImport() {
    await this.blank();
    return this.page.evaluate(async () => {
      const { importMap } = (await import(`${SRC}processing/import.ts`)) as typeof import("../src/processing/import");
      const { deleteStoredMap } = (await import(`${SRC}storage/payloads.ts`)) as typeof import("../src/storage/payloads");
      const blob = await (await fetch("/__bench/map.jpg")).blob();
      const start = performance.now();
      const map = await importMap(new File([blob], "bench.jpg", { type: "image/jpeg" }), () => {}, new AbortController().signal);
      const ms = performance.now() - start;
      await deleteStoredMap(map);
      return ms;
    });
  }

  private paperScan(megapixels: (map: MapRecord) => string): Scenario[] {
    const { paperRecord: map } = this, { paper } = this.fixtures;
    if (!map || !paper) return [];
    const name = `Text scan of ${megapixels(map)}, ${paper.blank} of ${paper.sections} sections blank`;
    return [{ name: "text", run: async () => ({ [name]: await this.timeTextScan(map) }) }];
  }

  private async timeTextScan(record: MapRecord) {
    await this.blank();
    return this.page.evaluate(async (map) => {
      const { detectMapText } = (await import(`${SRC}ocr/detect.ts`)) as typeof import("../src/ocr/detect");
      const start = performance.now();
      await detectMapText(map, () => {}, new AbortController().signal);
      return performance.now() - start;
    }, record);
  }

  /** Resolves with the last frame's time once the map has stopped repainting. */
  private quiet() {
    return this.page.evaluate(async ({ quiet }) => {
      const page = window as unknown as BenchWindow;
      for (const started = performance.now(); performance.now() - started < 60_000; ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const queued = page.MapViewer?.diagnostics()?.queuedTiles ?? 0;
        if (queued === 0 && performance.now() - page.__bench.last > quiet) return page.__bench.last;
      }
      throw new Error("The map kept repainting for a minute.");
    }, { quiet: QUIET_MS });
  }

  /** Opens the map at its whole view, then pinches in, pans, flings and pinches out on a slowed CPU. */
  private async moveMap(dark: boolean): Promise<Sample> {
    const { markers, metresPerPixel } = this.fixtures.map;
    await this.blank();
    await this.page.evaluate(async ({ map, markers, metresPerPixel, dark }) => {
      const { defaultNavigation } = (await import(`${SRC}viewer/navigation.ts`)) as typeof import("../src/viewer/navigation");
      const { saveNavigation, setLastMap } = (await import(`${SRC}storage/navigation.ts`)) as typeof import("../src/storage/navigation");
      // No saved view, so every run opens on the whole map.
      await saveNavigation({ ...defaultNavigation(map.id), markers, ...(metresPerPixel ? { metresPerPixel } : {}), inverted: dark });
      await setLastMap(map.id);
    }, { map: this.mapRecord, markers, metresPerPixel, dark });
    // The app reopens the last map at launch.
    await this.page.goto(`${this.origin}/`);
    await this.page.waitForFunction(() => (window as unknown as BenchWindow).__bench.viewerAt > 0, undefined, { timeout: 30_000 });
    const opened = await this.quiet();
    const openMs = opened - await this.page.evaluate(() => (window as unknown as BenchWindow).__bench.viewerAt);

    await this.cdp.send("Emulation.setCPUThrottlingRate", { rate: PHONE_SLOWDOWN });
    const busyBefore = await this.busySeconds();
    await this.page.evaluate(() => (window as unknown as BenchWindow).__bench.frames.clear());
    const fingers = new Fingers(this.cdp), { width, height } = PHONE.viewport;
    const centre = { x: width / 2, y: height / 2 };
    await fingers.pinch(centre, 60, 300, 24);
    const pinched = await this.page.evaluate(() => performance.now());
    const zoomMs = (await this.quiet()) - pinched;
    await fingers.drag({ x: centre.x, y: height * 0.75 }, { x: centre.x, y: height * 0.3 }, 24);
    await fingers.drag({ x: width * 0.8, y: centre.y }, { x: width * 0.2, y: centre.y }, 24);
    await fingers.drag({ x: centre.x, y: height * 0.35 }, { x: centre.x, y: height * 0.8 }, 6, true);
    await this.quiet();
    await fingers.pinch(centre, 300, 60, 24);
    await this.quiet();
    const busyMs = (await this.busySeconds() - busyBefore) * 1000;
    await this.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const frames = await this.page.evaluate(() => [...(window as unknown as BenchWindow).__bench.frames.values()]);

    const look = dark ? "dark" : "light";
    return {
      [`Open until sharp, ${look}`]: { ms: openMs, step: FRAME_MS },
      [`Pinch in until sharp, ${look}, ${PHONE_SLOWDOWN}× slower CPU`]: { ms: zoomMs, step: FRAME_MS },
      [`Frame work median, ${look}, ${PHONE_SLOWDOWN}× slower CPU`]: quantile(frames, 0.5),
      [`Frame work p95, ${look}, ${PHONE_SLOWDOWN}× slower CPU`]: quantile(frames, 0.95),
      [`Main thread busy while moving, ${look}, ${PHONE_SLOWDOWN}× slower CPU`]: busyMs,
    };
  }

  private async busySeconds() {
    const { metrics } = await this.cdp.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
  }

  async close() {
    await this.context.close().catch(() => {});
    this.server.kill();
    await rm(this.profile, { recursive: true, force: true });
  }
}
