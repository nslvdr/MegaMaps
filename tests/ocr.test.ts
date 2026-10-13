import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  normalizeText,
  needsOcr,
  searchOcr,
  ocrLabelAt,
  addOcrLine,
  OCR_VERSION,
  type OcrIndex,
  type OcrLine,
} from "../src/ocr/index";
import {
  OCR_WINDOW,
  ocrCrops,
  labelPoint,
  scanMap,
  scanSection,
  type OcrEngine,
} from "../src/ocr/scan";
import { configureRuntime, createTextDetector } from "../src/ocr/detector";
import { createTextRecognizer } from "../src/ocr/recognizer";
import { OcrTileCache, OCR_TILE_CACHE_BYTES } from "../src/ocr/tiles";
import { regionPoint } from "../src/ocr/regions";
import { pathToFileURL } from "node:url";
import {
  detectMapText,
  type OcrReply,
  type OcrRequest,
} from "../src/ocr/detect";
import { saveOcr, loadOcr } from "../src/storage/ocr";
import { saveMap, renameMap, listMaps } from "../src/storage/database";
import { payloadStore, deleteStoredMap } from "../src/storage/payloads";
import { SearchOverlay } from "../src/viewer/search-overlay";
import { worldToScreen } from "../src/viewer/camera";
import { tileKey, type MapRecord } from "../src/types";
import { installPlatform, nativeStats } from "./node-platform";

const polygon = (x: number, y = 30) => [
  { x, y },
  { x: x + 40, y },
  { x: x + 40, y: y + 15 },
  { x, y: y + 15 },
];
const index: OcrIndex = {
  mapId: "ocr-storage",
  version: OCR_VERSION,
  completedAt: 1,
  lines: [
    {
      text: "Église du Nord",
      confidence: 90,
      words: [
        { text: "Église", polygon: polygon(0) },
        { text: "du", polygon: polygon(50) },
        { text: "Nord", polygon: polygon(100) },
      ],
    },
  ],
};
const map: MapRecord = {
  id: index.mapId,
  name: "map.png",
  width: 1024,
  height: 1024,
  bytes: 1,
  backend: "indexeddb",
  levels: [],
  created: 1,
  status: "ready",
};

test("OCR search matches accents, phrases, and partial words without revealing unrelated words", () => {
  assert.equal(normalizeText(" ÉGLISE-du\nNord! "), "eglise du nord");
  assert.deepEqual(searchOcr(index, "glise du")[0]?.polygons, [
    polygon(0),
    polygon(50),
  ]);
  assert.deepEqual(searchOcr(index, "nord")[0]?.polygons, [polygon(100)]);
  assert.equal(searchOcr(index, "nord")[0]?.text, "Église du Nord", "callouts read the whole line");
  assert.equal(searchOcr(index, "unknown").length, 0);
  assert.equal(ocrLabelAt(index, { x: 60, y: 37 }), "Église du Nord", "a place dropped on a label takes its name");
  assert.equal(ocrLabelAt(index, { x: 45, y: 37 }), "Église du Nord", "between its words still counts");
  assert.equal(ocrLabelAt(index, { x: 60, y: 60 }), undefined, "open map keeps the numbered name");
  assert.equal(ocrLabelAt(undefined, { x: 60, y: 37 }), undefined);
  assert.equal(searchOcr(index, "  ").length, 0);
  assert.equal(needsOcr(undefined), true);
  assert.equal(
    needsOcr({ ...index, lines: [] }),
    false,
    "a completed empty scan is not repeated at every open",
  );
  assert.equal(needsOcr({ ...index, version: 0 }), true);
  const lines: OcrLine[] = [];
  addOcrLine(lines, index.lines[0]!);
  addOcrLine(lines, { ...index.lines[0]!, confidence: 99 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.confidence, 99);
  addOcrLine(lines, {
    ...index.lines[0]!,
    words: index.lines[0]!.words.map((word) => ({
      ...word,
      polygon: word.polygon.map((p) => ({ x: p.x + 500, y: p.y })),
    })),
  });
  assert.equal(
    lines.length,
    2,
    "repeated names at distinct places remain searchable",
  );
});

test("straightened label coordinates round-trip both directions at arbitrary angles and crop plans stay bounded", () => {
  const crop = { x: 1250, y: 2700, width: 700, height: 400 };
  for (const angle of [0, 0.127, Math.PI / 2, 2.53, -2.4]) {
    const region = {
      center: { x: 300, y: 200 },
      width: 220,
      height: 30,
      angle,
      score: 1,
    };
    const size = { width: 440, height: 45, scaleX: 2, scaleY: 1.5 };
    for (const reversed of [false, true]) {
      const x = 31,
        y = 9,
        direction = reversed ? -1 : 1;
      const world = regionPoint(region, direction * x, direction * y);
      const p = labelPoint(
        size.width / 2 + x * size.scaleX,
        size.height / 2 + y * size.scaleY,
        region,
        crop,
        size,
        reversed,
      );
      assert.ok(Math.abs(p.x - (crop.x + world.x)) < 1e-8);
      assert.ok(Math.abs(p.y - (crop.y + world.y)) < 1e-8);
    }
  }
  const crops = ocrCrops(15001, 9001);
  assert.ok(
    crops.every(
      (crop) => crop.width <= OCR_WINDOW && crop.height <= OCR_WINDOW,
    ),
  );
  assert.equal(Math.max(...crops.map((crop) => crop.x + crop.width)), 15001);
  assert.equal(Math.max(...crops.map((crop) => crop.y + crop.height)), 9001);
  assert.ok(crops[1]!.x < crops[0]!.width, "neighbouring sections overlap");
});

test("OCR storage preserves an old index during a rerun, rename preserves data, deletion rejects late OCR writes", async () => {
  await saveMap(map);
  await saveOcr(index);
  const persisted = await loadOcr(map.id);
  assert.deepEqual(persisted, index);
  await renameMap(map.id, "New name");
  assert.equal(
    (await listMaps()).find((m) => m.id === map.id)?.name,
    "New name",
  );
  assert.deepEqual(await loadOcr(map.id), index);
  await deleteStoredMap(map);
  assert.equal(await loadOcr(map.id), undefined);
  await assert.rejects(saveOcr(index), /no longer available/);
  assert.equal(await loadOcr(map.id), undefined);
});

test("search callouts and mask holes track pan, zoom, and rotation independently of display filters", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true,
  });
  const svg = document.querySelector<SVGSVGElement>("svg")!;
  const overlay = new SearchOverlay(svg);
  const match = searchOcr(index, "nord");
  overlay.set(match, true);
  const camera = { x: 10, y: 20, scale: 2, rotation: Math.PI / 3 };
  overlay.draw(camera, { width: 390, height: 844 });
  assert.equal(svg.hasAttribute("hidden"), false);
  assert.equal(svg.getAttribute("viewBox"), "0 0 390 844");
  assert.equal(
    svg.querySelector("polygon")!.getAttribute("points"),
    polygon(100)
      .map((point) => {
        const p = worldToScreen(camera, point);
        return `${p.x},${p.y}`;
      })
      .join(" "),
  );
  assert.equal(svg.style.filter, "");
  const matches = [
    ...match,
    { text: "<North>", polygons: [polygon(300)] },
  ];
  overlay.set(matches, true);
  const viewport = { width: 390, height: 844 };
  overlay.draw({ x: 50, y: 80, scale: 0.02 }, viewport);
  const first = svg.querySelector(".search-highlight")!;
  const tick = first.querySelector("line")!;
  assert.equal(tick.hasAttribute("hidden"), true, "the selected match uses its callout connector");
  assert.equal(first.hasAttribute("data-selected"), true);
  assert.equal(svg.querySelector(".search-selected-label text")!.textContent, "Église du Nord");
  const beforePan = tick.getAttribute("x2");
  overlay.draw({ x: 70, y: 80, scale: 0.02 }, viewport);
  assert.ok(Math.abs(Number(tick.getAttribute("x2")) - Number(beforePan) - 20) < 1e-9);
  overlay.draw({ x: 10, y: 80, scale: 2 }, viewport);
  assert.equal(tick.getAttribute("x2"), "250", "the connector follows the text center while zooming");
  assert.equal(tick.getAttribute("y2"), "140", "the connector ends on the text's upper edge");
  const label = svg.querySelector(".search-selected-label")!;
  const connector = label.querySelector("line")!;
  const labelPosition = () => label.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
  const endpoint = { x: labelPosition()[0]! + Number(connector.getAttribute("x2")),
    y: labelPosition()[1]! + Number(connector.getAttribute("y2")) };
  assert.ok(endpoint.x >= 210 && endpoint.x <= 290 && endpoint.y >= 140 && endpoint.y <= 170);
  assert.ok(endpoint.x === 210 || endpoint.x === 290 || endpoint.y === 140 || endpoint.y === 170,
    "the connector ends on the text boundary from any available direction");
  assert.equal(label.querySelector(".map-callout-icon")!.getAttribute("aria-hidden"), "true");
  overlay.set(matches, true, 1);
  overlay.draw({ x: 50, y: 80, scale: 0.02 }, viewport);
  assert.ok(svg.querySelector(".search-highlight") === first, "selection changes reuse the geometry");
  assert.equal(first.hasAttribute("data-selected"), false);
  assert.equal(svg.querySelectorAll(".search-highlight .map-callout:not([hidden])").length, 2, "all visible matches keep callouts when navigating");
  assert.equal(svg.querySelectorAll(".search-highlight[data-selected]").length, 1);
  assert.equal(svg.querySelector(".search-selected-label text")!.textContent, "<North>");
  assert.ok(!svg.querySelector(".search-selected-label North"), "OCR text is never markup");
  overlay.set(matches, true, 0);
  // Labels glide to a new spot; these checks are about where they settle.
  const settle = (camera: { x: number; y: number; scale: number }) => {
    overlay.draw(camera, viewport);
    now += 1000;
    overlay.draw(camera, viewport);
  };
  settle({ x: 0, y: 0, scale: 1 });
  assert.equal(labelPosition()[1], 67, "near the top edge, the callout moves below the text");
  assert.equal(connector.getAttribute("y1"), "0", "a lower callout connects through its top edge");
  settle({ x: 250, y: 80, scale: 1 });
  const calloutWidth = Number(label.querySelector("rect")!.getAttribute("width"));
  assert.ok(labelPosition()[0]! + calloutWidth <= viewport.width - 8,
    "the callout stays inside the screen near the right edge");
  overlay.set([{ text: "W".repeat(60), polygons: [polygon(0)] }], true);
  const labelText = svg.querySelector<SVGTextElement>(".map-callout text")!;
  Object.defineProperty(labelText, "getComputedTextLength", {
    value: () => Array.from(labelText.textContent!).length * 14,
  });
  overlay.draw({ x: 0, y: 80, scale: 1 }, { width: 120, height: 200 });
  assert.ok(labelText.textContent!.endsWith("…"), "long labels are truncated");
  assert.ok(labelText.getComputedTextLength() + 51 <= 104,
    "wide proportional letters fit beside the text icon within the available callout width");
  overlay.draw({ x: -1000, y: -1000, scale: 1 }, viewport);
  assert.equal(svg.querySelector(".search-selected-label")!.hasAttribute("hidden"), true,
    "offscreen matches do not leave a floating label over an unrelated location");
  const hole = svg.querySelector("mask polygon")!, onScreen = hole.getAttribute("points");
  assert.equal(hole.hasAttribute("hidden"), true, "an offscreen match does not cut into the shade");
  assert.equal(svg.querySelector(".search-highlight")!.hasAttribute("hidden"), true);
  overlay.draw({ x: -2000, y: -1000, scale: 1 }, viewport);
  assert.equal(hole.getAttribute("points"), onScreen, "offscreen matches are left alone while panning");
  overlay.draw({ x: 10, y: 80, scale: 1 }, viewport);
  assert.equal(hole.hasAttribute("hidden"), false, "a match back on screen cuts its hole again");
  assert.notEqual(hole.getAttribute("points"), onScreen);
  assert.equal(svg.querySelector(".search-highlight")!.hasAttribute("hidden"), false);
  overlay.set([], true);
  assert.equal(
    svg.hasAttribute("hidden"),
    false,
    "no matches shade the whole map",
  );
  assert.equal(svg.querySelectorAll("polygon").length, 0);
  overlay.set([], false);
  assert.equal(svg.hasAttribute("hidden"), true);
  overlay.dispose();
});

test("OCR workers share a map's sections, merge them in map order and stop together", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: OcrReply }) => void;
    onerror?: () => void;
    terminated = false;
    sections: number[] = [];
    constructor() {
      workers.push(this);
    }
    postMessage({ section }: OcrRequest) {
      this.sections.push(section);
    }
    terminate() {
      this.terminated = true;
    }
    reply(data: OcrReply) {
      this.onmessage?.({ data });
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    value: FakeWorker,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "hardwareConcurrency", {
    value: 3,
    configurable: true,
  });
  // Three sections for two workers.
  const wide = { ...map, width: 2560 };
  const line = (text: string, x: number): OcrLine => ({
    text,
    confidence: 90,
    words: [{ text, polygon: polygon(x) }],
  });
  await saveMap(wide);
  await saveOcr(index);
  const controller = new AbortController();
  const cancelled = detectMapText(wide, () => {}, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(workers.length, 2);
  assert.ok(workers.every((worker) => worker.terminated));
  assert.deepEqual(await loadOcr(map.id), index);
  workers.length = 0;
  const crashed = detectMapText(wide, () => {}, new AbortController().signal);
  workers[1]!.onerror?.();
  await assert.rejects(crashed, /unexpectedly/);
  workers.length = 0;
  const failed = detectMapText(wide, () => {}, new AbortController().signal);
  workers[0]!.reply({ type: "error", message: "Dictionary is missing." });
  await assert.rejects(failed, /Dictionary is missing/);
  assert.ok(workers.every((worker) => worker.terminated));
  assert.deepEqual(await loadOcr(map.id), index);
  workers.length = 0;
  const progress: number[] = [];
  const finished = detectMapText(
    wide,
    (p) => progress.push(p.fraction),
    new AbortController().signal,
  );
  const [first, second] = workers;
  assert.deepEqual([first!.sections, second!.sections], [[0], [1]]);
  second!.reply({ type: "progress", fraction: 0.5 });
  second!.reply({ type: "lines", lines: [line("Second", 100)] });
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(second!.sections, [1, 2], "a free worker takes the next section");
  second!.reply({ type: "lines", lines: [line("Third", 200)] });
  first!.reply({ type: "lines", lines: [line("First", 0)] });
  const scanned = await finished;
  assert.deepEqual(
    scanned.lines.map((line) => line.text),
    ["First", "Second", "Third"],
  );
  assert.ok(progress.includes(0.5 / 3));
  assert.equal(progress.at(-1), 1);
  assert.ok(workers.every((worker) => worker.terminated));
  assert.deepEqual(await loadOcr(map.id), scanned);
  workers.length = 0;
  Object.defineProperty(navigator, "deviceMemory", { value: 2, configurable: true });
  const stop = new AbortController();
  const lowMemory = detectMapText(wide, () => {}, stop.signal);
  stop.abort();
  await assert.rejects(lowMemory, { name: "AbortError" });
  assert.equal(workers.length, 1, "a phone with little memory scans with one worker");
  Reflect.deleteProperty(navigator, "deviceMemory");
  await deleteStoredMap(wide);
});

test(
  "real local OCR finds rotated, upside-down, dark, small and seam-crossing labels",
  { timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "mega-maps-ocr-"));
    await installPlatform(root);
    // Native canvases can draw each other; no browser automation is involved.
    Object.defineProperty(globalThis, "OffscreenCanvas", {
      configurable: true,
      value: class {
        constructor(width: number, height: number) {
          return createCanvas(width, height);
        }
      },
    });
    const require = createRequire(import.meta.url);
    configureRuntime(
      pathToFileURL(dirname(require.resolve("onnxruntime-web/wasm")) + "/")
        .href,
    );
    const asset = async (name: string) =>
      new Uint8Array(
        await readFile(new URL(`../assets/ocr/${name}`, import.meta.url)),
      );
    const detector = await createTextDetector(
      await asset("pp-ocrv5-mobile-det.onnx"),
    );
    const recognizer = await createTextRecognizer(
      await asset("pp-ocrv5-latin-rec.onnx"),
      await asset("pp-lcnet-textline-ori.onnx"),
      new TextDecoder().decode(await asset("latin-dict.txt")).split("\n"),
    );
    let recognitionCalls = 0;
    const engine: OcrEngine = {
      detect: detector.detect,
      upsideDown: recognizer.upsideDown,
      recognize: (line) => (recognitionCalls++, recognizer.recognize(line)),
    };
    const store = payloadStore("indexeddb");
    const record = {
      ...map,
      id: "ocr-real",
      levels: [{ width: 1024, height: 1024, scale: 1, cols: 2, rows: 2 }],
    };
    const save = async (image: Canvas) => {
      for (let y = 0; y * 512 < image.height; y++)
        for (let x = 0; x * 512 < image.width; x++) {
          const tile = createCanvas(
            Math.min(512, image.width - x * 512),
            Math.min(512, image.height - y * 512),
          );
          tile.getContext("2d").drawImage(image, -x * 512, -y * 512);
          await store.put(
            record.id,
            tileKey(0, x, y),
            new Blob([new Uint8Array(await tile.encode("png"))]),
          );
        }
      return { ...record, width: image.width, height: image.height };
    };
    // One worker's share of the production scan: every section, in order.
    const scan = async (
      target: MapRecord,
      using = engine,
      signal = new AbortController().signal,
      onProgress: (fraction: number) => void = () => {},
    ) => {
      const tiles = new OcrTileCache(target, store, signal);
      const crops = ocrCrops(target.width, target.height);
      try {
        return await scanMap(
          target,
          [
            (section, onPart) =>
              scanSection(target, tiles, crops[section]!, using, signal, onPart),
          ],
          (progress) => onProgress(progress.fraction),
          signal,
        );
      } finally {
        tiles.dispose();
      }
    };
    const draw = (
      image: Canvas,
      background: string,
      color: string,
      font: string,
      labels: { text: string; x: number; y: number; degrees: number }[],
    ) => {
      const ctx = image.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, image.width, image.height);
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      for (const label of labels) {
        ctx.save();
        ctx.translate(label.x, label.y);
        ctx.rotate((label.degrees * Math.PI) / 180);
        ctx.fillText(label.text, 0, 0);
        ctx.restore();
      }
      return image;
    };
    const labels = [
      { text: "NORTH GATE", x: 512, y: 130, degrees: 0 },
      { text: "RIVER ROAD", x: 300, y: 365, degrees: 37 },
      { text: "WEST TOWER", x: 800, y: 440, degrees: 90 },
      { text: "SOUTH EXIT", x: 512, y: 740, degrees: 173 },
      { text: "EAST BRIDGE", x: 180, y: 770, degrees: 254 },
    ];
    try {
      const plain = await save(
        draw(createCanvas(1024, 1024), "white", "#222", "bold 30px sans-serif", labels),
      );
      const progress: number[] = [];
      const detected = await scan(plain, engine, undefined, (fraction) =>
        progress.push(fraction),
      );
      for (const label of labels) {
        const matches = searchOcr(detected, label.text);
        assert.ok(
          matches.length > 0,
          `${label.degrees}° label missing: ${label.text}; got ${detected.lines.map((l) => l.text).join(", ")}`,
        );
        assert.ok(
          matches.some((match) => {
            const points = match.polygons.flat();
            const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
            const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
            return Math.hypot(x - label.x, y - label.y) < 35;
          }),
          "highlight maps back to the original text position",
        );
      }
      assert.equal(progress.at(-1), 1);
      assert.equal(nativeStats.decodedBytes, 0);
      assert.ok(
        nativeStats.peakDecodedBytes <= OCR_TILE_CACHE_BYTES,
        "decoded overlap tiles stay within the scan cache budget",
      );
      // A sure orientation is read once; an unsure one both ways, keeping the
      // more confident reading even when the classifier leaned the wrong way.
      const northGate = async () => [
        { center: { x: 512, y: 130 }, width: 260, height: 60, angle: 0, score: 1 },
      ];
      for (const [upside, reads] of [
        [0.02, 1],
        [0.4, 2],
        [0.6, 2],
      ] as const) {
        recognitionCalls = 0;
        const oriented = await scan(plain, {
          ...engine,
          detect: northGate,
          upsideDown: async () => [upside],
        });
        assert.equal(recognitionCalls, reads, `${upside} upside down`);
        assert.ok(searchOcr(oriented, "north gate").length > 0, `${upside} upside down`);
      }
      const cancel = new AbortController();
      recognitionCalls = 0;
      await assert.rejects(
        scan(
          plain,
          {
            ...engine,
            detect: northGate,
            recognize: async (line) => {
              cancel.abort();
              return engine.recognize(line);
            },
          },
          cancel.signal,
        ),
        { name: "AbortError" },
      );
      assert.equal(recognitionCalls, 1);
      assert.equal(nativeStats.decodedBytes, 0);
      // Empty detector output reads nothing and still finishes a valid index.
      recognitionCalls = 0;
      const empty = await scan(plain, { ...engine, detect: async () => [] });
      assert.equal(recognitionCalls, 0);
      assert.deepEqual(empty.lines, []);
      const darkCavern = [{ text: "DARK CAVERN", x: 256, y: 256, degrees: -58 }];
      const dark = await scan(
        await save(
          draw(createCanvas(512, 512), "#111", "white", "bold 36px sans-serif", darkCavern),
        ),
      );
      assert.ok(
        searchOcr(dark, "dark cavern").length > 0,
        "rotated white labels on dark maps are searchable",
      );
      // A label across an internal section edge is read whole, once.
      const border = await scan(
        await save(
          draw(createCanvas(1280, 512), "white", "black", "bold 28px sans-serif", [
            { text: "BORDER PASSAGE", x: 1020, y: 256, degrees: 37 },
          ]),
        ),
      );
      assert.equal(searchOcr(border, "border passage").length, 1);
      const small = await scan(
        await save(
          draw(createCanvas(1024, 1024), "white", "#222", "bold 14px sans-serif", labels),
        ),
      );
      for (const label of labels)
        assert.ok(
          searchOcr(small, label.text).length > 0,
          `14px label at ${label.degrees}° remains searchable; got ${small.lines.map((l) => l.text).join(", ")}`,
        );
      const smallDark = await scan(
        await save(
          draw(createCanvas(512, 512), "#111", "white", "bold 16px sans-serif", darkCavern),
        ),
      );
      assert.ok(
        searchOcr(smallDark, "dark cavern").length > 0,
        "16px diagonal white labels on dark maps remain searchable",
      );
    } finally {
      await detector.dispose();
      await recognizer.dispose();
      await store.deleteMap(record.id);
      await rm(root, { recursive: true, force: true });
    }
  },
);
