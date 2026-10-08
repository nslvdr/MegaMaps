import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// Benchmark production WASM detection plus OCR while enforcing the accuracy tests.
const require = createRequire(import.meta.url);
const output = execFileSync(
  process.execPath,
  ["--import", require.resolve("tsx"), "--test", "tests/ocr.test.ts"],
  {
    env: { ...process.env, OCR_BENCHMARK: "1" },
    encoding: "utf8",
  },
);
const results = [...output.matchAll(/OCR_BENCHMARK (\{[^\n]+\})/g)].map(
  (match) =>
    JSON.parse(match[1]!) as {
      fixture: string;
      ms: number;
      recognitionCalls?: number;
    },
);
if (results.length !== 3)
  throw new Error("OCR benchmark did not produce all fixture results.");
console.log(
  JSON.stringify(
    {
      node: process.version,
      architecture: process.arch,
      runtime: "ONNX Runtime Web WASM, one thread",
      note: "Synthetic native-canvas fixtures; no browser or device timing. Setup excludes Tesseract startup; scan results exclude both engine startups.",
      results,
    },
    null,
    2,
  ),
);
