import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Static imports the page itself loads, following relative paths; type-only
// imports vanish at build time. Workers load through new URL(), not import.
function pageImports(entry: string) {
  const seen = new Map<string, string[]>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^;"]*?\sfrom\s+)?"([^"]+)"/gm)].map((match) => match[1] ?? "");
    seen.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const base = resolve(dirname(file), specifier);
      const found = [`${base}.ts`, `${base}/index.ts`].find(existsSync);
      if (found) visit(found);
    }
  };
  visit(resolve(entry));
  return seen;
}

test("the page loads without ONNX Runtime, which only the OCR worker needs", () => {
  const imports = pageImports("src/main.ts");
  assert.ok(imports.has(resolve("src/ocr/scan.ts")));
  const loaders = [...imports].filter(([, specifiers]) => specifiers.some((s) => s.startsWith("onnxruntime-web")));
  assert.deepEqual(loaders.map(([file]) => file), []);
});
