// Tests read the English sentences, so the device language is English.
const items = new Map([["megamaps:language", "en"]]);
globalThis.localStorage = {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => void items.set(key, value),
  removeItem: (key: string) => void items.delete(key),
  clear: () => items.clear(),
  key: (index: number) => [...items.keys()][index] ?? null,
  get length() { return items.size; },
};
// Components compile on import, as the app's build does.
import { register } from "node:module";
register("./svelte-hooks.ts", import.meta.url);
