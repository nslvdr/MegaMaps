import { locale, t } from "../i18n";
export { plural } from "../i18n";

export function formatBytes(bytes: number) {
  if (bytes < 1024) return t("<1 KB");
  if (bytes < 1024 * 1024) return t("{size} KB", { size: Math.round(bytes / 1024) });
  return t("{size} MB", { size: (bytes / (1024 * 1024)).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
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
  const date = new Date(time).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(new Date(time).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
  if (map.opened)
    return days <= 0 ? t("Opened today") : days === 1 ? t("Opened yesterday")
      : days < 7 ? t("Opened {days} days ago", { days }) : t("Opened {date}", { date });
  return days <= 0 ? t("Added today") : days === 1 ? t("Added yesterday")
    : days < 7 ? t("Added {days} days ago", { days }) : t("Added {date}", { date });
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

/** "Seen today", "Seen 3 weeks ago", "Seen 14 months ago": how fresh a place's information is. */
export function seenAgo(time: number, now = Date.now()) {
  const day = (t: number) => {
    const date = new Date(t);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  };
  const days = Math.max(0, day(now) - day(time));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const when = days < 14 ? relative.format(-days, "day")
    : days < 60 ? relative.format(-Math.round(days / 7), "week")
    : days < 730 ? relative.format(-Math.round(days / 30.44), "month")
    : relative.format(-Math.round(days / 365.25), "year");
  return t("Seen {when}", { when });
}

/** A log entry's day, with its year: logs reach back further than this year. */
export const logDate = (time: number) =>
  new Date(time).toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit" });
