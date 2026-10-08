import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

// Ship OCR with the app shell; runtime never downloads code/models from a CDN.
export function prepareOcrAssets() {
  const require = createRequire(import.meta.url);
  const root = resolve("public/ocr");
  mkdirSync(root, { recursive: true });
  const packageRoot = (name: string) =>
    dirname(require.resolve(`${name}/package.json`));
  copyFileSync(
    resolve(packageRoot("tesseract.js"), "dist/worker.min.js"),
    resolve(root, "worker.min.js"),
  );
  copyFileSync(
    resolve(packageRoot("tesseract.js"), "LICENSE.md"),
    resolve(root, "TESSERACT-LICENSE.md"),
  );
  copyFileSync(
    resolve(packageRoot("tesseract.js-core"), "LICENSE"),
    resolve(root, "CORE-LICENSE"),
  );
  for (const variant of ["lstm", "simd-lstm", "relaxedsimd-lstm"])
    copyFileSync(
      resolve(
        packageRoot("tesseract.js-core"),
        `tesseract-core-${variant}.wasm.js`,
      ),
      resolve(root, `tesseract-core-${variant}.wasm.js`),
    );
  copyFileSync(
    resolve(
      packageRoot("@tesseract.js-data/eng"),
      "4.0.0_best_int/eng.traineddata.gz",
    ),
    resolve(root, "eng.traineddata.gz"),
  );
  const model = resolve("assets/ocr/pp-ocrv5-mobile-det.onnx");
  if (
    createHash("sha256").update(readFileSync(model)).digest("hex") !==
    "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d"
  )
    throw new Error("OCR text detector model failed its integrity check.");
  copyFileSync(model, resolve(root, "pp-ocrv5-mobile-det.onnx"));
  copyFileSync(
    resolve("assets/ocr/PADDLE-LICENSE"),
    resolve(root, "PADDLE-LICENSE"),
  );
  const ortRoot = dirname(require.resolve("onnxruntime-web/wasm"));
  for (const name of [
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ])
    copyFileSync(resolve(ortRoot, name), resolve(root, name));
  copyFileSync(
    resolve("assets/ocr/ONNX-LICENSE"),
    resolve(root, "ONNX-LICENSE"),
  );
}
