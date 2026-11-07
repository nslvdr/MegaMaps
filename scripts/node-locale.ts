// The app's text module reads the language from localStorage, which Node lacks.
const items = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => void items.set(key, value),
  removeItem: (key: string) => void items.delete(key),
  clear: () => items.clear(),
  key: () => null,
  get length() { return items.size; },
};
