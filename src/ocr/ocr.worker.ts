import type { MapRecord } from "../types";
import type { OcrReply, OcrRequest } from "./detect";
import { payloadStore } from "../storage/payloads";
import { ocrCrops, scanSection } from "./scan";
import { OcrTileCache } from "./tiles";
import { configureRuntime, createTextDetector } from "./detector";
import { createTextRecognizer } from "./recognizer";
import { staged, tagged, type OcrStage } from "./failure";

const reply = (message: OcrReply) => self.postMessage(message);
// The worker is terminated rather than aborted, so its scans never stop early.
const signal = new AbortController().signal;

async function start(map: MapRecord) {
  const assets = new URL("/ocr/", self.location.origin);
  configureRuntime(assets.href);
  // The worker downloads the models itself rather than leaving it to ONNX Runtime,
  // so a failure tells which file didn't load apart from the runtime not starting.
  const download = <T>(stage: OcrStage, name: string, read: (response: Response) => Promise<T>) =>
    staged(stage, (async () => {
      const response = await fetch(new URL(name, assets));
      if (!response.ok) throw new Error(`${name} is missing (${response.status}).`);
      return read(response);
    })());
  const model = (stage: OcrStage, name: string) =>
    download(stage, name, async (response) => new Uint8Array(await response.arrayBuffer()));
  const [detector, recognizer] = await Promise.all([
    model("detector", "pp-ocrv5-mobile-det.onnx").then((bytes) =>
      staged("runtime", createTextDetector(bytes)),
    ),
    Promise.all([
      model("recognizer", "pp-ocrv5-latin-rec.onnx"),
      model("recognizer", "pp-lcnet-textline-ori.onnx"),
      download("dictionary", "latin-dict.txt", async (response) => (await response.text()).split("\n")),
    ]).then(([reader, orienter, characters]) =>
      staged("runtime", createTextRecognizer(reader, orienter, characters)),
    ),
  ]);
  const store = payloadStore(map.backend);
  return {
    engine: { ...recognizer, detect: detector.detect },
    tiles: new OcrTileCache(
      map,
      { get: (id, key) => staged("tiles", store.get(id, key)) },
      signal,
    ),
    crops: ocrCrops(map.width, map.height),
  };
}

let ready: ReturnType<typeof start> | undefined;

// One worker reads one section at a time; the models load with the first.
// Failures carry their name and step, as the page can't receive the error itself.
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
    const { name, message, stage } = tagged(error, "scan");
    reply({ type: "error", name, message, stage });
  }
};
