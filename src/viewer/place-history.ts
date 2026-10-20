import { dangerLevel, type MapMarker, type PlaceChange } from "./navigation";

/** The order changes read in, whatever order they were made in. */
const fields: PlaceChange["field"][] = ["name", "kind", "water", "danger", "description", "photos", "point"];
type Span = Extract<PlaceChange, { field: "name" | "kind" | "water" | "danger" }>;
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** When the place last changed: its newest visit, note or edit, else when it was added. */
export const lastUpdated = (place: MapMarker) =>
  Math.max(place.created, ...(place.log ?? []).map((entry) => entry.date));

/** What saving `after` over `before` changed. A new type brings its own level, so a
 * level only gets a line of its own within the same type. */
export function placeChanges(before: MapMarker, after: MapMarker) {
  const changes: PlaceChange[] = [];
  if (before.label !== after.label) changes.push({ field: "name", from: before.label, to: after.label });
  if (before.kind !== after.kind) changes.push({ field: "kind", from: before.kind, to: after.kind });
  else if (after.kind === "flooded" && before.water !== after.water)
    changes.push({ field: "water", from: before.water, to: after.water });
  else if (after.kind === "unstable" && dangerLevel(before) !== dangerLevel(after))
    changes.push({ field: "danger", from: dangerLevel(before)!, to: dangerLevel(after)! });
  if (before.description !== after.description) changes.push({ field: "description" });
  const had = before.photos ?? [], has = after.photos ?? [];
  const added = has.filter((id) => !had.includes(id)), removed = had.filter((id) => !has.includes(id));
  if (added.length || removed.length) changes.push({ field: "photos", added, removed });
  if (before.point.x !== after.point.x || before.point.y !== after.point.y) changes.push({ field: "point" });
  return changes;
}

/** One change on top of an earlier one of the same field; undefined when they cancel out. */
function fold(earlier: PlaceChange, later: PlaceChange): PlaceChange | undefined {
  if (later.field === "photos" && earlier.field === "photos") {
    // A photo removed and put back, or added and removed, is no change.
    const added = [...earlier.added.filter((id) => !later.removed.includes(id)),
      ...later.added.filter((id) => !earlier.removed.includes(id))];
    const removed = [...earlier.removed.filter((id) => !later.added.includes(id)),
      ...later.removed.filter((id) => !earlier.added.includes(id))];
    return added.length || removed.length ? { field: "photos", added, removed } : undefined;
  }
  if (later.field === "description" || later.field === "photos" || later.field === "point") return later;
  const spanned = { ...later, from: (earlier as Span).from } as Span;
  return spanned.from === spanned.to ? undefined : spanned;
}

/** Adds an edit to the place's history. An edit on the same day as the latest entry, when
 * that is an edit too, folds into it so a run of fixes reads as one entry. The folded entry
 * takes a new ID, so a copy shared before the fold arrives beside it rather than over it. */
export function recordEdit(place: MapMarker, changes: PlaceChange[], now = Date.now()) {
  if (!changes.length) return;
  const log = [...place.log ?? []];
  const latest = log.at(-1);
  if (latest?.changes && sameDay(latest.date, now)) {
    log.pop();
    place.deletedLog = [...place.deletedLog ?? [], latest.id];
    const byField = new Map(latest.changes.map((change) => [change.field, change]));
    for (const change of changes) {
      const earlier = byField.get(change.field);
      const folded = earlier ? fold(earlier, change) : change;
      if (folded) byField.set(change.field, folded);
      else byField.delete(change.field);
    }
    changes = [...byField.values()].sort((a, b) => fields.indexOf(a.field) - fields.indexOf(b.field));
  }
  if (changes.length) log.push({ id: crypto.randomUUID(), date: now, changes });
  if (log.length) place.log = log;
  else delete place.log;
}
