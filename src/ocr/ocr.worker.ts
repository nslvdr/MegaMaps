import { createWorker, OEM, PSM } from "tesseract.js";
import type { MapRecord } from "../types";
import type { OcrReply } from "./detect";
import { payloadStore } from "../storage/payloads";
import { scanMap } from "./scan";

const reply = (message: OcrReply) => self.postMessage(message);

// All raster preprocessing stays off the UI thread; the model is local-only.
self.onmessage = async (event: MessageEvent<MapRecord>) => {
  try {
    const worker = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: new URL("/ocr/worker.min.js", self.location.origin).href,
      corePath: new URL("/ocr", self.location.origin).href,
      langPath: new URL("/ocr", self.location.origin).href,
      workerBlobURL: false,
      cacheMethod: "none",
      errorHandler: (error: unknown) =>
        reply({ type: "error", message: String(error) }),
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: "150",
      });
      const map = event.data;
      const index = await scanMap(
        map,
        payloadStore(map.backend),
        async (image) =>
          (await worker.recognize(image, {}, { blocks: true, text: false }))
            .data,
        (progress) => reply({ type: "progress", progress }),
        new AbortController().signal,
      );
      reply({ type: "done", index });
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    reply({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
