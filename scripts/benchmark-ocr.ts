import "fake-indexeddb/auto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { createCanvas } from "@napi-rs/canvas";
import { installPlatform } from "../tests/node-platform";
import { payloadStore } from "../src/storage/payloads";
import { normalizeText, searchOcr, type OcrIndex, type OcrLine } from "../src/ocr/index";
import { ocrCrops, scanMap, scanSection } from "../src/ocr/scan";
import { OcrTileCache } from "../src/ocr/tiles";
import { configureRuntime, createTextDetector } from "../src/ocr/detector";
import { createTextRecognizer } from "../src/ocr/recognizer";
import { tileKey, type MapRecord } from "../src/types";
import { quarryMap, type TruthLabel } from "./ocr-fixture";

// Scan the synthetic quarry sheet with the production pipeline, one worker
// thread per app OCR worker, and score it against the labels drawn on it.
// Usage: npm run benchmark:ocr -- [workers]
const WIDTH = 3000, HEIGHT = 2400;
const map: MapRecord = {
  id: "benchmark", name: "benchmark", width: WIDTH, height: HEIGHT, bytes: 1, backend: "indexeddb",
  levels: [{ width: WIDTH, height: HEIGHT, scale: 1, cols: Math.ceil(WIDTH / 512), rows: Math.ceil(HEIGHT / 512) }],
  created: 1, status: "ready",
};

type Message = { type: "ready"; ms: number } | { type: "lines"; lines: OcrLine[] };

// Each thread has its own storage, so each draws the same seeded sheet.
async function worker() {
  const root = await mkdtemp(join(tmpdir(), "ocr-benchmark-"));
  await installPlatform(root);
  const { canvas } = await quarryMap(WIDTH, HEIGHT);
  const store = payloadStore("indexeddb");
  for (let y = 0; y * 512 < HEIGHT; y++)
    for (let x = 0; x * 512 < WIDTH; x++) {
      const tile = createCanvas(Math.min(512, WIDTH - x * 512), Math.min(512, HEIGHT - y * 512));
      tile.getContext("2d").drawImage(canvas, -x * 512, -y * 512);
      await store.put(map.id, tileKey(0, x, y), new Blob([new Uint8Array(await tile.encode("png"))]));
    }
  const started = performance.now();
  const require = createRequire(import.meta.url);
  configureRuntime(pathToFileURL(dirname(require.resolve("onnxruntime-web/wasm")) + "/").href);
  const asset = async (name: string) => new Uint8Array(await readFile(`assets/ocr/${name}`));
  const detector = await createTextDetector(await asset("pp-ocrv5-mobile-det.onnx"));
  const recognizer = await createTextRecognizer(await asset("pp-ocrv5-latin-rec.onnx"),
    await asset("pp-lcnet-textline-ori.onnx"), new TextDecoder().decode(await asset("latin-dict.txt")).split("\n"));
  const engine = { ...recognizer, detect: detector.detect };
  const signal = new AbortController().signal;
  const tiles = new OcrTileCache(map, store, signal);
  const crops = ocrCrops(WIDTH, HEIGHT);
  parentPort!.on("message", async (section: number | null) => {
    if (section === null) {
      tiles.dispose();
      await rm(root, { recursive: true, force: true });
      process.exit(0);
    }
    const lines = await scanSection(map, tiles, crops[section]!, engine, signal);
    parentPort!.postMessage({ type: "lines", lines } satisfies Message);
  });
  parentPort!.postMessage({ type: "ready", ms: performance.now() - started } satisfies Message);
}

const inside = (label: TruthLabel, point: { x: number; y: number }, pad: number) => {
  const dx = point.x - label.x, dy = point.y - label.y;
  const c = Math.cos(label.angle), s = Math.sin(label.angle);
  return Math.abs(c * dx + s * dy) <= label.width / 2 + pad && Math.abs(-s * dx + c * dy) <= label.height / 2 + pad;
};
const centre = (points: { x: number; y: number }[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});
// A label counts when searching its text highlights its own position.
const found = (index: OcrIndex, label: TruthLabel, text: string) =>
  searchOcr(index, text).some((match) => inside(label, centre(match.polygons.flat()), 12));

async function main() {
  const count = Number(process.argv[2]) || Math.max(1, Math.min(3, availableParallelism() - 1));
  const { labels } = await quarryMap(WIDTH, HEIGHT);
  // Worker threads do not inherit tsx's loader, so each registers its own.
  const bootstrap = `import { register } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))}; register(); await import(${JSON.stringify(import.meta.url)});`;
  const threads = Array.from({ length: count }, () =>
    new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), { workerData: "ocr" }));
  const next = (thread: Worker) => new Promise<Message>((resolve) => thread.once("message", resolve));
  const startup = await Promise.all(threads.map(next));
  const started = performance.now();
  const index = await scanMap(map, threads.map((thread) => async (section) => {
    const reply = next(thread);
    thread.postMessage(section);
    return ((await reply) as Extract<Message, { type: "lines" }>).lines;
  }), () => {}, new AbortController().signal);
  const ms = performance.now() - started;
  for (const thread of threads) thread.postMessage(null);
  const words = labels.flatMap((label) =>
    normalizeText(label.text).split(" ").filter((word) => word.length >= 2).map((word) => found(index, label, word)));
  const missed = labels.filter((label) => !found(index, label, label.text));
  console.log(JSON.stringify({
    node: process.version,
    architecture: process.arch,
    workers: count,
    note: "Synthetic 3000×2400 quarry sheet, 170 labels; native canvas, no browser timing.",
    modelLoadMs: Math.round(Math.max(...startup.map((reply) => (reply as Extract<Message, { type: "ready" }>).ms))),
    scanMs: Math.round(ms),
    labelRecall: +(1 - missed.length / labels.length).toFixed(3),
    wordRecall: +(words.filter(Boolean).length / words.length).toFixed(3),
    spurious: index.lines.filter((line) =>
      !labels.some((label) => inside(label, centre(line.words.flatMap((word) => word.polygon)), 12))).length,
    missed: missed.map((label) => `${label.text} (${label.height}px)`),
  }, null, 2));
}

if (isMainThread) void main();
else if (workerData === "ocr") void worker();
