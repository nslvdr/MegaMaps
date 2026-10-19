import { locale, t } from "../i18n";
import { preference } from "../preferences";
import type { Point, Size } from "./camera";

// How far past the whole-map view saved names show on maps without a scale.
const LABEL_ZOOM = 3;

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

/** The zoom from which saved names show: once the screen's shorter side spans
 * the distance set in Settings, or a few zooms in without a scale. The closest
 * zoom always shows them. */
export function labelZoom(limits: { min: number; max: number }, viewport: Size, metresPerPixel?: number) {
  const distance = preference("label-distance");
  if (distance === "always") return 0;
  const close = metresPerPixel
    ? Math.min(viewport.width, viewport.height) * metresPerPixel / Number(distance)
    : limits.min * LABEL_ZOOM;
  return Math.min(close, limits.max);
}
