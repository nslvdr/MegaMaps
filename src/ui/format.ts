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

/** "Opened today", "Added 3 days ago", "Opened Mar 4": when a map was last used. */
export function lastUsed(map: { created: number; opened?: number }, now = Date.now()) {
  const time = map.opened ?? map.created;
  const day = (t: number) => {
    const date = new Date(t);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  };
  const days = day(now) - day(time);
  const when =
    days <= 0 ? "today"
    : days === 1 ? "yesterday"
    : days < 7 ? `${days} days ago`
    : new Date(time).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(new Date(time).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
      });
  return `${map.opened ? "Opened" : "Added"} ${when}`;
}

/** "Entrance 3": one past the highest number already given to this kind, so
 *  names count per kind and a deletion never makes a duplicate. */
export function nextName(base: string, names: Iterable<string>) {
  let highest = 0;
  for (const name of names) {
    const number = name.startsWith(`${base} `) ? Number(name.slice(base.length + 1)) : NaN;
    if (Number.isInteger(number) && number > highest) highest = number;
  }
  return `${base} ${highest + 1}`;
}
