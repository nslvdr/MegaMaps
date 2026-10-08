import { copyFileSync, mkdirSync } from "node:fs";
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
}
