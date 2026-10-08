export function formatBytes(bytes: number) {
  if (bytes < 1024) return "<1 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1 place", "2 places". */
export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Map names keep their file name in storage; the list hides the extension. */
export function displayName(name: string) {
  return name.replace(/\.(jpe?g|png|webp)$/i, "") || name;
}
