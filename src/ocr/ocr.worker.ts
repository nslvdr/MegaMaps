import { createWorker, OEM, PSM } from "tesseract.js";
import type { MapRecord } from "../types";
import type { OcrReply } from "./detect";
import { payloadStore } from "../storage/payloads";
import { scanMap } from "./scan";
import { createTextDetector } from "./detector";

const reply = (message: OcrReply) => self.postMessage(message);

// All raster preprocessing stays off the UI thread; the model is local-only.
self.onmessage = async (event: MessageEvent<MapRecord>) => {
  try {
    const assets = new URL("/ocr/", self.location.origin);
    const worker = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: new URL("worker.min.js", assets).href,
      corePath: assets.href,
      langPath: assets.href,
      workerBlobURL: false,
      cacheMethod: "none",
      errorHandler: (error: unknown) =>
        reply({ type: "error", message: String(error) }),
    });
    let detector: Awaited<ReturnType<typeof createTextDetector>> | undefined;
    try {
      reply({
        type: "progress",
        progress: {
          fraction: 0,
          message: "Starting local text-region detector…",
        },
      });
      detector = await createTextDetector(
        new URL("pp-ocrv5-mobile-det.onnx", assets).href,
        assets.href,
      );
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        user_defined_dpi: "150",
      });
      const map = event.data;
      const index = await scanMap(
        map,
        payloadStore(map.backend),
        detector.detect,
        async (image) =>
          (await worker.recognize(image, {}, { blocks: true, text: false }))
            .data,
        (progress) => reply({ type: "progress", progress }),
        new AbortController().signal,
      );
      reply({ type: "done", index });
    } finally {
      try {
        await detector?.dispose();
      } finally {
        await worker.terminate();
      }
    }
  } catch (error) {
    reply({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
