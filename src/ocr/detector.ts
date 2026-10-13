import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import { probabilityRegions } from "./regions";

export const sessionOptions: InferenceSession.SessionOptions = {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
  // The exported models carry unused initializers that ONNX Runtime warns about.
  logSeverityLevel: 3,
};

// Single-threaded WASM works without cross-origin isolation or WebGPU on phones;
// parallelism comes from running several OCR workers instead.
export function configureRuntime(runtimePath: string) {
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = runtimePath;
  env.logLevel = "error";
}

// Normalize BGR channels exactly as the bundled PP-OCRv5 detector expects.
// The image sits top-left; padding to the model's 32-pixel stride stays zero.
export function detectorInput(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  paddedWidth = width,
  paddedHeight = height,
) {
  const plane = paddedWidth * paddedHeight,
    data = new Float32Array(plane * 3);
  const means = [0.485, 0.456, 0.406],
    stds = [0.229, 0.224, 0.225];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4,
        target = y * paddedWidth + x;
      for (let channel = 0; channel < 3; channel++)
        data[channel * plane + target] =
          (pixels[source + 2 - channel]! / 255 - means[channel]!) /
          stds[channel]!;
    }
  return new Tensor("float32", data, [1, 3, paddedHeight, paddedWidth]);
}

// Text is found at the map's own resolution: shrinking a section first loses
// the small print that quarry plans are full of.
export async function createTextDetector(model: string | Uint8Array) {
  const session =
    typeof model === "string"
      ? await InferenceSession.create(model, sessionOptions)
      : await InferenceSession.create(model, sessionOptions);
  return {
    async detect(source: OffscreenCanvas) {
      const { width, height } = source;
      const ctx = source.getContext("2d", { willReadFrequently: true })!;
      const tensor = detectorInput(
        ctx.getImageData(0, 0, width, height).data,
        width,
        height,
        Math.ceil(width / 32) * 32,
        Math.ceil(height / 32) * 32,
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
        );
      } finally {
        tensor.dispose();
        if (outputs)
          for (const output of Object.values(outputs)) output.dispose();
      }
    },
    async dispose() {
      await session.release();
    },
  };
}
