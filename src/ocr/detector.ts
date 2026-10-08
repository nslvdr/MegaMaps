import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import { probabilityRegions } from "./regions";

export const DETECTOR_SIDE = 768;

// Normalize BGR channels exactly as the bundled PP-OCRv5 detector expects.
export function detectorInput(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const size = width * height,
    data = new Float32Array(size * 3);
  const means = [0.485, 0.456, 0.406],
    stds = [0.229, 0.224, 0.225];
  for (let i = 0; i < size; i++)
    for (let channel = 0; channel < 3; channel++)
      data[channel * size + i] =
        (pixels[i * 4 + 2 - channel]! / 255 - means[channel]!) / stds[channel]!;
  return new Tensor("float32", data, [1, 3, height, width]);
}

// Single-threaded WASM works without cross-origin isolation or WebGPU on phones.
export async function createTextDetector(
  model: string | Uint8Array = "/ocr/pp-ocrv5-mobile-det.onnx",
  runtimePath = "/ocr/",
) {
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = runtimePath;
  const options = {
    executionProviders: ["wasm"],
    enableCpuMemArena: false,
    enableMemPattern: false,
  };
  const session =
    typeof model === "string"
      ? await InferenceSession.create(model, options)
      : await InferenceSession.create(model, options);
  const canvas = new OffscreenCanvas(1, 1);
  return {
    async detect(source: OffscreenCanvas) {
      const ratio = Math.min(
        1,
        DETECTOR_SIDE / Math.max(source.width, source.height),
      );
      canvas.width = Math.max(32, Math.round((source.width * ratio) / 32) * 32);
      canvas.height = Math.max(
        32,
        Math.round((source.height * ratio) / 32) * 32,
      );
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const tensor = detectorInput(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      );
      let outputs: InferenceSession.ReturnType | undefined;
      try {
        outputs = await session.run({ [session.inputNames[0]!]: tensor });
        const output = outputs[session.outputNames[0]!]!;
        if (!(output.data instanceof Float32Array) || output.dims.length !== 4)
          throw new Error("Unexpected text detector output.");
        return probabilityRegions(
          output.data,
          output.dims[3]!,
          output.dims[2]!,
          source.width,
          source.height,
        );
      } finally {
        tensor.dispose();
        if (outputs)
          for (const output of Object.values(outputs)) output.dispose();
      }
    },
    async dispose() {
      canvas.width = canvas.height = 1;
      await session.release();
    },
  };
}
