// Node can't read Svelte components; this compiles them as the app's build does.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import type { LoadHook } from "node:module";

export const load: LoadHook = async (url, context, nextLoad) => {
  if (url.endsWith(".svelte")) {
    const filename = fileURLToPath(url);
    const { js } = compile(await readFile(filename, "utf8"), { filename, generate: "client" });
    return { format: "module", source: js.code, shortCircuit: true };
  }
  if (/\.svelte\.[jt]s$/.test(url)) {
    const loaded = await nextLoad(url, context);
    const { js } = compileModule(String(loaded.source), { filename: fileURLToPath(url), generate: "client" });
    return { format: "module", source: js.code, shortCircuit: true };
  }
  return nextLoad(url, context);
};
