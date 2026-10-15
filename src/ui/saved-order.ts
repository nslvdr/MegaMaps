import { t } from "../i18n";
import type { Preferences } from "../preferences";
import { lastSeen, markerKinds, type MapMarker, type PlannedRoute } from "../viewer/navigation";

export type PlaceOrder = Preferences["place-order"];
export type RouteOrder = Preferences["route-order"];
/** Menu order; routes have no type or visits, so they offer only the first three. */
export const placeOrders = {
  newest: t("Newest"),
  oldest: t("Oldest"),
  name: t("A–Z"),
  type: t("Type"),
  seen: t("Last seen"),
} satisfies Record<PlaceOrder, string>;
export const routeOrders = {
  newest: placeOrders.newest,
  oldest: placeOrders.oldest,
  name: placeOrders.name,
} satisfies Record<RouteOrder, string>;

// "Entrance 2" comes before "Entrance 10", whatever the case or accents.
const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const kindRank = Object.keys(markerKinds);

// Sorting is stable, so ties keep the order the items were saved in.
export function orderPlaces(markers: readonly MapMarker[], order: PlaceOrder) {
  const compare: Record<PlaceOrder, (a: MapMarker, b: MapMarker) => number> = {
    newest: (a, b) => b.created - a.created,
    oldest: (a, b) => a.created - b.created,
    name: (a, b) => byName(a.label, b.label),
    type: (a, b) => kindRank.indexOf(a.kind) - kindRank.indexOf(b.kind) || byName(a.label, b.label),
    seen: (a, b) => lastSeen(b) - lastSeen(a),
  };
  return [...markers].sort(compare[order]);
}

export function orderRoutes(routes: readonly PlannedRoute[], order: RouteOrder) {
  const compare: Record<RouteOrder, (a: PlannedRoute, b: PlannedRoute) => number> = {
    newest: (a, b) => b.created - a.created,
    oldest: (a, b) => a.created - b.created,
    name: (a, b) => byName(a.name, b.name),
  };
  return [...routes].sort(compare[order]);
}
