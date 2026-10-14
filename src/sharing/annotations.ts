import { lastSeen, type MapMarker, type NavigationState } from "../viewer/navigation";
import type { ShareManifest } from "./format";

/** The same place seen elsewhere: its own text stays, but the newer visit and every
 * log entry not deleted on either side add up. Returns `local` when nothing is new. */
export function mergeVisits(local: MapMarker, other: MapMarker): MapMarker {
  const deleted = new Set([...local.deletedLog ?? [], ...other.deletedLog ?? []]);
  const ids = new Set<string>();
  const log = [...local.log ?? [], ...structuredClone(other.log ?? [])]
    .filter((entry) => !deleted.has(entry.id) && !ids.has(entry.id) && ids.add(entry.id));
  // The last change to last seen wins, so a correction to an earlier day sticks;
  // without one on either side, the later visit does.
  const localAt = local.seenAt ?? 0, otherAt = other.seenAt ?? 0;
  const theirs = otherAt === localAt ? lastSeen(other) > lastSeen(local) : otherAt > localAt;
  if (!theirs && log.length === (local.log?.length ?? 0) &&
      deleted.size === (local.deletedLog?.length ?? 0)) return local;
  const merged: MapMarker = { ...local };
  if (theirs) {
    merged.lastSeen = lastSeen(other);
    if (other.seenAt) merged.seenAt = other.seenAt;
  }
  if (log.length) merged.log = log;
  else delete merged.log;
  if (deleted.size) merged.deletedLog = [...deleted];
  return merged;
}

/** Imported IDs survive local edits and deletion; new exports only add unseen items,
 * and places already here only gain newer visits and log entries.
 * A shared north fills in a map that has none, but never undoes local tuning. */
export function mergeAnnotations(state: NavigationState, share: ShareManifest) {
  const shared = new Map(share.markers.map((item) => [item.id, item]));
  let updated = 0;
  const existing = state.markers.map((marker) => {
    const other = shared.get(marker.id);
    const merged = other ? mergeVisits(marker, other) : marker;
    if (merged !== marker) updated++;
    return merged;
  });
  const seen = new Set(state.importedItems ?? []);
  for (const marker of state.markers) seen.add(`marker:${marker.id}`);
  for (const route of state.routes) seen.add(`route:${route.id}`);
  const markers = share.markers.filter((item) => !seen.has(`marker:${item.id}`));
  const routes = share.routes.filter((item) => !seen.has(`route:${item.id}`));
  const history = new Set(state.importedItems ?? []);
  for (const marker of share.markers) history.add(`marker:${marker.id}`);
  for (const route of share.routes) history.add(`route:${route.id}`);
  return {
    state: { ...state, northOffset: state.northOffset || (share.northOffset ?? 0),
      markers: [...existing, ...structuredClone(markers)],
      routes: [...state.routes, ...structuredClone(routes)], importedItems: [...history] },
    added: markers.length + routes.length,
    updated,
    skipped: share.markers.length + share.routes.length - markers.length - routes.length - updated,
  };
}

/** Replace swaps every place and finished route for the shared ones, and north when the
 * share has one; unfinished drafts stay. */
export function replaceAnnotations(state: NavigationState, share: ShareManifest) {
  const removed = state.markers.length + state.routes.filter((route) => !route.draft).length;
  return {
    state: { ...state, northOffset: share.northOffset ?? state.northOffset,
      markers: structuredClone(share.markers),
      routes: [...state.routes.filter((route) => route.draft), ...structuredClone(share.routes)],
      annotationRevision: (state.annotationRevision ?? 0) + 1,
      importedItems: [...share.markers.map((item) => `marker:${item.id}`), ...share.routes.map((item) => `route:${item.id}`)] },
    added: share.markers.length + share.routes.length,
    updated: 0,
    skipped: 0,
    removed,
  };
}

/** Reconcile imports and replacements before an older window saves or refreshes. */
export function preserveUnseenImports(next: NavigationState, stored?: NavigationState): NavigationState {
  if (stored && (stored.annotationRevision ?? 0) > (next.annotationRevision ?? 0)) {
    return { ...next,
      northOffset: stored.northOffset,
      markers: structuredClone(stored.markers),
      routes: [...next.routes.filter((route) => route.draft), ...structuredClone(stored.routes.filter((route) => !route.draft))],
      importedItems: [...(stored.importedItems ?? [])],
      annotationRevision: stored.annotationRevision,
    };
  }
  // Visits and log entries made in another window add up with this one's.
  if (stored) {
    const others = new Map(stored.markers.map((item) => [item.id, item]));
    next = { ...next, markers: next.markers.map((item) => {
      const other = others.get(item.id);
      return other ? mergeVisits(item, other) : item;
    }) };
  }
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
