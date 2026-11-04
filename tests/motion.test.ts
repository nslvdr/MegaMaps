import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { motion } from "../src/ui/motion";

test("the map's own motion keeps the same timings as the page's", () => {
  const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
  const tokens = Object.fromEntries([...css.matchAll(/--motion-(\w+):\s*([\d.]+)(ms|s);/g)]
    .map(([, name, value, unit]) => [name, Number(value) * (unit === "s" ? 1000 : 1)]));
  assert.deepEqual(tokens, motion);
});
