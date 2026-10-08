import { defineConfig, defaultClientConditions } from "vite";
import { readFileSync } from "node:fs";
import { prepareOcrAssets } from "./scripts/ocr-assets";
prepareOcrAssets();
// A phone needs trusted HTTPS for service workers; localhost works on desktop.
const cert = process.env.MAP_VIEWER_HTTPS_CERT,
  key = process.env.MAP_VIEWER_HTTPS_KEY;
if (Boolean(cert) !== Boolean(key))
  throw new Error("Set both MAP_VIEWER_HTTPS_CERT and MAP_VIEWER_HTTPS_KEY.");
const https =
  cert && key
    ? { cert: readFileSync(cert), key: readFileSync(key) }
    : undefined;
export default defineConfig({
  // Resolve ONNX's external-WASM entry; one local runtime copy is precached below.
  resolve: {
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
  server: { host: "0.0.0.0", https },
  preview: { host: "0.0.0.0", https },
});
