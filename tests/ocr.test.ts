import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mkdtemp, rm, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker, OEM, PSM } from "tesseract.js";
import {
  normalizeText,
  needsOcr,
  searchOcr,
  addOcrLine,
  type OcrIndex,
  type OcrLine,
} from "../src/ocr/index";
import { OCR_WINDOW, ocrCrops, labelPoint, scanMap } from "../src/ocr/scan";
import { createTextDetector } from "../src/ocr/detector";
import { startOcrEngines } from "../src/ocr/engines";
import { OCR_TILE_CACHE_BYTES } from "../src/ocr/tiles";
import { regionPoint } from "../src/ocr/regions";
import { pathToFileURL } from "node:url";
import { detectMapText, type OcrReply } from "../src/ocr/detect";
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
  version: 1,
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
  assert.equal(searchOcr(index, "unknown").length, 0);
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
    const size = { width: 440, height: 60, scale: 2 };
    for (const reversed of [false, true]) {
      const x = 31,
        y = 9,
        direction = reversed ? -1 : 1;
      const world = regionPoint(region, direction * x, direction * y);
      const p = labelPoint(
        size.width / 2 + x * size.scale,
        size.height / 2 + y * size.scale,
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

test("search callouts and mask holes track pan, zoom, and rotation independently of display filters", () => {
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
  assert.equal(svg.querySelector(".search-selected-label text")!.textContent, "Nord");
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
  overlay.draw({ x: 0, y: 0, scale: 1 }, viewport);
  assert.equal(labelPosition()[1], 67, "near the top edge, the callout moves below the text");
  assert.equal(connector.getAttribute("y1"), "0", "a lower callout connects through its top edge");
  overlay.draw({ x: 250, y: 80, scale: 1 }, viewport);
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

test("OCR worker cancellation during startup and worker errors preserve the saved index", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: OcrReply }) => void;
    onerror?: () => void;
    terminated = false;
    sent?: MapRecord;
    constructor() {
      workers.push(this);
    }
    postMessage(map: MapRecord) {
      this.sent = map;
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    value: FakeWorker,
    configurable: true,
    writable: true,
  });
  await saveMap(map);
  await saveOcr(index);
  const controller = new AbortController();
  const cancelled = detectMapText(map, () => {}, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(workers[0]?.terminated, true);
  assert.deepEqual(await loadOcr(map.id), index);
  const failed = detectMapText(map, () => {}, new AbortController().signal);
  workers[1]!.onerror?.();
  await assert.rejects(failed, /unexpectedly/);
  assert.equal(workers[1]?.terminated, true);
  assert.deepEqual(await loadOcr(map.id), index);
  const progress: number[] = [];
  const finished = detectMapText(
    map,
    (p) => progress.push(p.fraction),
    new AbortController().signal,
  );
  workers[2]!.onmessage?.({
    data: { type: "progress", progress: { fraction: 0.5, message: "Halfway" } },
  });
  const replacement = { ...index, completedAt: 2 };
  workers[2]!.onmessage?.({ data: { type: "done", index: replacement } });
  assert.deepEqual(await finished, replacement);
  assert.ok(progress.includes(0.5));
  assert.equal(workers[2]?.terminated, true);
  assert.deepEqual(await loadOcr(map.id), replacement);
  await deleteStoredMap(map);
});

test(
  "real local OCR finds horizontal, diagonal, vertical and upside-down labels across tile boundaries",
  { timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "mega-maps-ocr-"));
    await installPlatform(root);
    // Native canvases can draw each other; no browser automation is involved.
    Object.defineProperty(globalThis, "OffscreenCanvas", {
      configurable: true,
      value: class {
        constructor(width: number, height: number) {
          const canvas = createCanvas(width, height);
          Object.defineProperty(canvas, "convertToBlob", {
            value: async () =>
              new Blob([new Uint8Array(await canvas.encode("png"))]),
          });
          return canvas;
        }
      },
    });
    const require = createRequire(import.meta.url);
    const labels = [
      { text: "NORTH GATE", x: 512, y: 130, degrees: 0 },
      { text: "RIVER ROAD", x: 300, y: 365, degrees: 37 },
      { text: "WEST TOWER", x: 800, y: 440, degrees: 90 },
      { text: "SOUTH EXIT", x: 512, y: 740, degrees: 173 },
      { text: "EAST BRIDGE", x: 180, y: 770, degrees: 254 },
    ];
    const source = createCanvas(1024, 1024);
    const ctx = source.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of labels) {
      ctx.save();
      ctx.translate(label.x, label.y);
      ctx.rotate((label.degrees * Math.PI) / 180);
      ctx.fillStyle = "#222";
      ctx.fillText(label.text, 0, 0);
      ctx.restore();
    }
    const record = {
      ...map,
      id: "ocr-real",
      levels: [{ width: 1024, height: 1024, scale: 1, cols: 2, rows: 2 }],
    };
    const store = payloadStore("indexeddb");
    const detectorStarted = performance.now();
    const model = new Uint8Array(
      await readFile(
        new URL("../assets/ocr/pp-ocrv5-mobile-det.onnx", import.meta.url),
      ),
    );
    await copyFile(
      new URL("../assets/ocr/eng-fast.traineddata.gz", import.meta.url),
      join(root, "eng.traineddata.gz"),
    );
    const { detector, recognizer: worker } = await startOcrEngines(
      createWorker("eng", OEM.LSTM_ONLY, {
        langPath: root,
        cacheMethod: "none",
      }),
      createTextDetector(
        model,
        pathToFileURL(dirname(require.resolve("onnxruntime-web/wasm")) + "/")
          .href,
      ),
    );
    const setupMs = performance.now() - detectorStarted;
    if (process.env.OCR_BENCHMARK)
      console.log(
        "OCR_BENCHMARK",
        JSON.stringify({ fixture: "setup", ms: setupMs }),
      );
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        user_defined_dpi: "150",
      });
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const tile = createCanvas(512, 512);
          tile.getContext("2d").drawImage(source, -x * 512, -y * 512);
          await store.put(
            record.id,
            tileKey(0, x, y),
            new Blob([new Uint8Array(await tile.encode("png"))]),
          );
        }
      const progress: number[] = [];
      let recognitionCalls = 0;
      const scanStarted = performance.now();
      const recognize = async (image: Blob) =>
        (recognitionCalls++,
        await worker.recognize(
          Buffer.from(await image.arrayBuffer()),
          {},
          { blocks: true, text: false },
        )).data;
      const detected = await scanMap(
        record,
        store,
        detector.detect,
        recognize,
        (p) => progress.push(p.fraction),
        new AbortController().signal,
      );
      if (process.env.OCR_BENCHMARK)
        console.log(
          "OCR_BENCHMARK",
          JSON.stringify({
            fixture: "light",
            ms: performance.now() - scanStarted,
            recognitionCalls,
            rssMiB: process.memoryUsage().rss / 1048576,
          }),
        );
      assert.equal(
        recognitionCalls,
        5,
        "confident label crops skip the opposite reading direction",
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
      // A high page score alone cannot skip empty output or a weak word.
      for (const mode of ["page", "word", "empty"]) {
        let directionCalls = 0;
        const retried = await scanMap(
          record,
          store,
          async () => [
            {
              center: { x: 512, y: 130 },
              width: 260,
              height: 60,
              angle: mode === "empty" ? Math.PI : 0,
              score: 1,
            },
          ],
          async (image) => {
            directionCalls++;
            if (directionCalls === 1 && mode === "empty")
              return { blocks: null, confidence: 99 };
            const data = await recognize(image);
            if (directionCalls === 1) {
              if (mode === "page") data.confidence = 80;
              if (mode === "word") {
                data.confidence = 99;
                const word =
                  data.blocks?.[0]?.paragraphs[0]?.lines[0]?.words[0];
                assert.ok(word);
                word.confidence = 60;
              }
            }
            return data;
          },
          () => {},
          new AbortController().signal,
        );
        assert.equal(
          directionCalls,
          2,
          `${mode} retries the reverse direction`,
        );
        assert.ok(searchOcr(retried, "north gate").length > 0);
      }
      const cancel = new AbortController();
      let calls = 0;
      await assert.rejects(
        scanMap(
          record,
          store,
          async () => [
            {
              center: { x: 100, y: 100 },
              width: 60,
              height: 20,
              angle: 0,
              score: 1,
            },
          ],
          async () => {
            calls++;
            cancel.abort();
            return { blocks: null, confidence: 0 };
          },
          () => {},
          cancel.signal,
        ),
        { name: "AbortError" },
      );
      assert.equal(calls, 1);
      assert.equal(nativeStats.decodedBytes, 0);
      // A dark source is normalized without changing its stored pixels.
      const dark = createCanvas(512, 512);
      const dc = dark.getContext("2d");
      dc.fillStyle = "#111";
      dc.fillRect(0, 0, 512, 512);
      dc.fillStyle = "white";
      dc.font = "bold 36px sans-serif";
      dc.textAlign = "center";
      dc.textBaseline = "middle";
      dc.save();
      dc.translate(256, 256);
      dc.rotate((-58 * Math.PI) / 180);
      dc.fillText("DARK CAVERN", 0, 0);
      dc.restore();
      await store.put(
        record.id,
        tileKey(0, 0, 0),
        new Blob([new Uint8Array(await dark.encode("png"))]),
      );
      recognitionCalls = 0;
      const darkStarted = performance.now();
      const darkIndex = await scanMap(
        { ...record, width: 512, height: 512 },
        store,
        detector.detect,
        recognize,
        () => {},
        new AbortController().signal,
      );
      if (process.env.OCR_BENCHMARK)
        console.log(
          "OCR_BENCHMARK",
          JSON.stringify({
            fixture: "dark",
            ms: performance.now() - darkStarted,
            recognitionCalls,
            rssMiB: process.memoryUsage().rss / 1048576,
          }),
        );
      assert.equal(recognitionCalls, 1);
      assert.ok(
        searchOcr(darkIndex, "dark cavern").length > 0,
        "rotated white labels on dark maps are searchable",
      );
      // Labels clipped by an internal section edge are supplied by its overlap.
      const wide = createCanvas(1280, 512),
        wc = wide.getContext("2d");
      wc.fillStyle = "white";
      wc.fillRect(0, 0, 1280, 512);
      wc.font = "bold 28px sans-serif";
      wc.textAlign = "center";
      wc.textBaseline = "middle";
      wc.translate(1020, 256);
      wc.rotate((37 * Math.PI) / 180);
      wc.fillStyle = "black";
      wc.fillText("BORDER PASSAGE", 0, 0);
      for (let x = 0; x < 3; x++) {
        const tile = createCanvas(Math.min(512, 1280 - x * 512), 512);
        tile.getContext("2d").drawImage(wide, -x * 512, 0);
        await store.put(
          record.id,
          tileKey(0, x, 0),
          new Blob([new Uint8Array(await tile.encode("png"))]),
        );
      }
      recognitionCalls = 0;
      const borderIndex = await scanMap(
        { ...record, width: 1280, height: 512 },
        store,
        detector.detect,
        recognize,
        () => {},
        new AbortController().signal,
      );
      assert.equal(searchOcr(borderIndex, "border passage").length, 1);
      assert.equal(
        recognitionCalls,
        1,
        "a clipped fragment is skipped and the complete label is read once",
      );
      // Empty detector output performs no recognition work and still finishes a valid index.
      let emptyCalls = 0;
      const emptyIndex = await scanMap(
        { ...record, width: 512, height: 512 },
        store,
        async () => [],
        async () => {
          emptyCalls++;
          return { blocks: null, confidence: 0 };
        },
        () => {},
        new AbortController().signal,
      );
      assert.equal(emptyCalls, 0);
      assert.deepEqual(emptyIndex.lines, []);
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.font = "bold 14px sans-serif";
      for (const label of labels) {
        ctx.save();
        ctx.translate(label.x, label.y);
        ctx.rotate((label.degrees * Math.PI) / 180);
        ctx.fillStyle = "#222";
        ctx.fillText(label.text, 0, 0);
        ctx.restore();
      }
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const tile = createCanvas(512, 512);
          tile.getContext("2d").drawImage(source, -x * 512, -y * 512);
          await store.put(
            record.id,
            tileKey(0, x, y),
            new Blob([new Uint8Array(await tile.encode("png"))]),
          );
        }
      const smallIndex = await scanMap(
        record,
        store,
        detector.detect,
        recognize,
        () => {},
        new AbortController().signal,
      );
      for (const label of labels)
        assert.ok(
          searchOcr(smallIndex, label.text).length > 0,
          `14px label at ${label.degrees}° remains searchable`,
        );
      dc.fillStyle = "#111";
      dc.fillRect(0, 0, 512, 512);
      dc.font = "bold 16px sans-serif";
      dc.fillStyle = "white";
      dc.save();
      dc.translate(256, 256);
      dc.rotate((-58 * Math.PI) / 180);
      dc.fillText("DARK CAVERN", 0, 0);
      dc.restore();
      await store.put(
        record.id,
        tileKey(0, 0, 0),
        new Blob([new Uint8Array(await dark.encode("png"))]),
      );
      const smallDark = await scanMap(
        { ...record, width: 512, height: 512 },
        store,
        detector.detect,
        recognize,
        () => {},
        new AbortController().signal,
      );
      assert.ok(
        searchOcr(smallDark, "dark cavern").length > 0,
        "16px diagonal white labels on dark maps remain searchable",
      );
    } finally {
      await detector.dispose();
      await worker.terminate();
      await store.deleteMap(record.id);
      await rm(root, { recursive: true, force: true });
    }
  },
);
