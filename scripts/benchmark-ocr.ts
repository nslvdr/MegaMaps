import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// Benchmark production WASM detection plus OCR while enforcing the accuracy tests.
const require = createRequire(import.meta.url);
const output = execFileSync(
  process.execPath,
  [
    "--import",
    require.resolve("tsx"),
    "--test",
    "--test-concurrency=1",
    "tests/ocr.test.ts",
    "tests/ocr-optimizations.test.ts",
  ],
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
if (results.length !== 4)
  throw new Error("OCR benchmark did not produce all fixture results.");
console.log(
  JSON.stringify(
    {
      node: process.version,
      architecture: process.arch,
      runtime: "ONNX Runtime Web WASM, one thread",
      note: "Synthetic native-canvas fixtures; no browser or device timing. Setup includes both concurrent engine startups; scans exclude setup. Tile-cache fixture uses empty detection to isolate crop assembly and decoded memory.",
      results,
    },
    null,
    2,
  ),
);
