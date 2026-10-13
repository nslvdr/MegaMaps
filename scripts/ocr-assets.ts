import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

// Pinned PaddleOCR models; README.md in assets/ocr names their sources.
const MODELS = {
  "pp-ocrv5-mobile-det.onnx":
    "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d",
  "pp-ocrv5-latin-rec.onnx":
    "7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498",
  "pp-lcnet-textline-ori.onnx":
    "94a6a0a0425f2b5f08b5df72086f2d72abe40f1d22f6d12d2cd83674f11f2ff3",
  "latin-dict.txt":
    "c3ab00106e4a4d151a8575b1129b91901a68a35b79a81fd63faab00418b87d75",
};

// Ship OCR with the app shell; runtime never downloads code/models from a CDN.
export function prepareOcrAssets() {
  const require = createRequire(import.meta.url);
  const root = resolve("public/ocr");
  mkdirSync(root, { recursive: true });
  for (const [name, hash] of Object.entries(MODELS)) {
    const model = resolve("assets/ocr", name);
    if (createHash("sha256").update(readFileSync(model)).digest("hex") !== hash)
      throw new Error(`OCR model ${name} failed its integrity check.`);
    copyFileSync(model, resolve(root, name));
  }
  const ortRoot = dirname(require.resolve("onnxruntime-web/wasm"));
  for (const name of [
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ])
    copyFileSync(resolve(ortRoot, name), resolve(root, name));
  for (const license of ["PADDLE-LICENSE", "ONNX-LICENSE"])
    copyFileSync(resolve("assets/ocr", license), resolve(root, license));
}
