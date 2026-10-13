import type { MapRecord } from "../types";
import type { OcrReply, OcrRequest } from "./detect";
import { payloadStore } from "../storage/payloads";
import { ocrCrops, scanSection } from "./scan";
import { OcrTileCache } from "./tiles";
import { configureRuntime, createTextDetector } from "./detector";
import { createTextRecognizer } from "./recognizer";

const reply = (message: OcrReply) => self.postMessage(message);
// The worker is terminated rather than aborted, so its scans never stop early.
const signal = new AbortController().signal;

async function start(map: MapRecord) {
  const assets = new URL("/ocr/", self.location.origin);
  const asset = (name: string) => new URL(name, assets).href;
  configureRuntime(assets.href);
  const dictionary = fetch(asset("latin-dict.txt")).then(async (response) => {
    if (!response.ok) throw new Error("Text recognizer dictionary is missing.");
    return (await response.text()).split("\n");
  });
  const [detector, recognizer] = await Promise.all([
    createTextDetector(asset("pp-ocrv5-mobile-det.onnx")),
    dictionary.then((characters) =>
      createTextRecognizer(
        asset("pp-ocrv5-latin-rec.onnx"),
        asset("pp-lcnet-textline-ori.onnx"),
        characters,
      ),
    ),
  ]);
  return {
    engine: { ...recognizer, detect: detector.detect },
    tiles: new OcrTileCache(map, payloadStore(map.backend), signal),
    crops: ocrCrops(map.width, map.height),
  };
}

let ready: ReturnType<typeof start> | undefined;

// One worker reads one section at a time; the models load with the first.
self.onmessage = async ({ data: { map, section } }: MessageEvent<OcrRequest>) => {
  try {
    ready ??= start(map);
    const { engine, tiles, crops } = await ready;
    const lines = await scanSection(
      map,
      tiles,
      crops[section]!,
      engine,
      signal,
      (fraction) => reply({ type: "progress", fraction }),
    );
    reply({ type: "lines", lines });
  } catch (error) {
    reply({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
