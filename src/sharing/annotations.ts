import type { NavigationState } from "../viewer/navigation";
import type { ShareManifest } from "./format";

/** Imported IDs survive local edits and deletion; new exports only add unseen items. */
export function mergeAnnotations(state: NavigationState, share: ShareManifest) {
  const seen = new Set(state.importedItems ?? []);
  for (const marker of state.markers) seen.add(`marker:${marker.id}`);
  for (const route of state.routes) seen.add(`route:${route.id}`);
  const markers = share.markers.filter((item) => !seen.has(`marker:${item.id}`));
  const routes = share.routes.filter((item) => !seen.has(`route:${item.id}`));
  const history = new Set(state.importedItems ?? []);
  for (const marker of share.markers) history.add(`marker:${marker.id}`);
  for (const route of share.routes) history.add(`route:${route.id}`);
  return {
    state: { ...state, markers: [...state.markers, ...structuredClone(markers)],
      routes: [...state.routes, ...structuredClone(routes)], importedItems: [...history] },
    added: markers.length + routes.length,
    skipped: share.markers.length + share.routes.length - markers.length - routes.length,
  };
}

/** A camera save from another tab must not erase imports it has not seen yet. */
export function preserveUnseenImports(next: NavigationState, stored?: NavigationState): NavigationState {
  if (!stored?.importedItems?.length) return next;
  const seen = new Set(next.importedItems ?? []);
  const unseen = new Set(stored.importedItems.filter((id) => !seen.has(id)));
  const markerIds = new Set(next.markers.map((item) => item.id));
  const routeIds = new Set(next.routes.map((item) => item.id));
  return { ...next,
    markers: [...next.markers, ...stored.markers.filter((item) => unseen.has(`marker:${item.id}`) && !markerIds.has(item.id))],
    routes: [...next.routes, ...stored.routes.filter((item) => unseen.has(`route:${item.id}`) && !routeIds.has(item.id))],
    importedItems: [...new Set([...seen, ...stored.importedItems])],
  };
}
