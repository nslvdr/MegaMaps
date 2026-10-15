import { locale, t } from "../i18n";
import { preference } from "../preferences";
import type { Point } from "./camera";

/** Length of a line through the points, in image pixels. */
export const pathLength = (points: Point[]) =>
  points.reduce((sum, point, index) => {
    const previous = points[index - 1];
    return previous ? sum + Math.hypot(point.x - previous.x, point.y - previous.y) : sum;
  }, 0);

/** "4.5 m", "420 m", "1.24 km": a scale set by hand is only so precise. */
export function formatDistance(metres: number) {
  if (metres >= 1000)
    return t("{distance} km", { distance: (metres / 1000).toLocaleString(locale, { maximumFractionDigits: metres >= 10_000 ? 1 : 2 }) });
  return t("{distance} m", { distance: metres.toLocaleString(locale, { maximumFractionDigits: metres < 10 ? 1 : 0 }) });
}

/** "< 1 min", "6 min", "1 h 03" at the walking speed set in Settings. */
export function formatWalk(metres: number) {
  const minutes = Math.round((metres / 1000 / Number(preference("walking-speed"))) * 60);
  if (minutes < 1) return t("< 1 min");
  if (minutes < 60) return t("{minutes} min", { minutes });
  return t("{hours} h {minutes}", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") });
}

/** "420 m · ~6 min on foot"; nothing until the map has a scale and the line two points. */
export function travelSummary(points: Point[], metresPerPixel?: number) {
  if (!metresPerPixel || points.length < 2) return undefined;
  const metres = pathLength(points) * metresPerPixel;
  return t("{distance} · ~{time} on foot", { distance: formatDistance(metres), time: formatWalk(metres) });
}
