import { t } from "../i18n";
import type { Camera, Point, Size } from "./camera";
import { screenToWorld, cameraAt } from "./camera";
import { isTrailPoint, isTrip, type TrailPoint, type Trip } from "./trail";
export interface SavedView {
  center: Point;
  scale: number;
  rotation: number;
}
export interface MapMarker {
  id: string;
  point: Point;
  label: string;
  description: string;
  /** Photo IDs, shown in this order; the blobs live in the photos store. */
  photos?: string[];
  kind: keyof typeof markerKinds;
  /** How deep the water is; only flooded places have one. */
  water?: WaterLevel;
  /** How dangerous a danger place is; without one it reads as high. */
  danger?: DangerLevel;
  created: number;
  /** The nickname of whoever added it, filled in when it's sent; none means it was added here. */
  by?: string;
  /** Visits, notes and edits, in the order they were added. */
  log?: PlaceLogEntry[];
  /** IDs of log entries deleted here, so a merge can't bring them back. Never shared. */
  deletedLog?: string[];
}
/** What one edit changed; names, types and levels keep both sides so history reads "A → B". */
export type PlaceChange =
  | { field: "name"; from: string; to: string }
  | { field: "kind"; from: MapMarker["kind"]; to: MapMarker["kind"] }
  | { field: "water"; from?: WaterLevel; to?: WaterLevel }
  | { field: "danger"; from: DangerLevel; to: DangerLevel }
  | { field: "description" }
  | { field: "photos"; added: string[]; removed: string[] }
  | { field: "point" };
/** A note, an edit's changes, or neither: a visit. */
export interface PlaceLogEntry {
  id: string;
  /** The day of the visit, as a timestamp; it can be earlier than when it was written. */
  date: number;
  text?: string;
  changes?: PlaceChange[];
  /** Whoever wrote it, as for places. */
  by?: string;
}
/** Saves and shares from before 2026-10-20 kept a last seen date beside the log. It becomes
 * a visit unless an entry already reaches that day; its ID is its date, so copies agree. */
export function visitFromLastSeen(log: PlaceLogEntry[] | undefined, created: number, lastSeen?: number) {
  if (!lastSeen || lastSeen <= created || log?.some((entry) => entry.date >= lastSeen)) return log;
  return [...log ?? [], { id: `seen-${lastSeen}`, date: lastSeen }];
}
/** Saved by older versions; now loaded as places. */
interface LegacyCheckpoint {
  id: string;
  point: Point;
  label: string;
  confirmed: number;
}
export interface PlannedRoute {
  id: string;
  name: string;
  /** Read and edited in the same card as a place's. */
  description?: string;
  /** Photo IDs, shown in this order; the blobs live in the photos store. */
  photos?: string[];
  points: Point[];
  created: number;
  /** Whoever drew it, as for places. */
  by?: string;
  draft: boolean;
}
export interface Layers {
  places: boolean;
  routes: boolean;
  labels: boolean;
}
export const layerNames = [
  "places",
  "routes",
  "labels",
] as const satisfies readonly (keyof Layers)[];
/** free: twist with two fingers · compass: turns with the phone · locked: stays put */
export type RotationMode = "free" | "compass" | "locked";
/** Map north is a whole number of degrees, a little over -180 up to 180. */
export const NORTH_MIN = -179, NORTH_MAX = 180;
export const wrapNorth = (degrees: number) => {
  const wrapped = ((Math.round(degrees) + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
};
export interface NavigationState {
  mapId: string;
  view?: SavedView;
  rotationMode: RotationMode;
  /** Where north is on this map, in degrees clockwise from its top. */
  northOffset: number;
  /** Real metres one image pixel covers; unset until the user sets the scale. */
  metresPerPixel?: number;
  /** Smart "dark map" mode. Stored under its version 1 name for compatibility. */
  inverted: boolean;
  dimming: number;
  touchLocked: boolean;
  markers: MapMarker[];
  routes: PlannedRoute[];
  /** The trip under way: where the user marked themselves, oldest first. Kept on this device, never shared. */
  trail: TrailPoint[];
  /** Trips that have ended, oldest first. Kept on this device, never shared. */
  trips: Trip[];
  /** Stable imported identities, retained when an imported item is deleted. */
  importedItems?: string[];
  /** Incremented by Replace so older windows cannot restore removed annotations. */
  annotationRevision?: number;
  layers: Layers;
}
/** Slightly dimmed by default so routes and places stand out from the map. */
export const DEFAULT_DIMMING = 0.85;
export const BRIGHTNESS_LEVELS = [1, DEFAULT_DIMMING, 0.75, 0.65, 0.55] as const;
export const brightnessPercent = (level: number) => Math.round(level * 100);
/** marker: tap to drop a new place · route: draw/edit · move: reposition a place ·
 *  measure: tap a line to read its length · scale: tap two ends of a known length ·
 *  trail: tap where you are */
export type Tool = "browse" | "marker" | "route" | "move" | "measure" | "scale" | "trail";
export function defaultNavigation(mapId: string): NavigationState {
  return {
    mapId,
    rotationMode: "locked",
    northOffset: 0,
    inverted: true, // Underground use: start dark and save OLED battery.
    dimming: DEFAULT_DIMMING,
    touchLocked: false,
    markers: [],
    routes: [],
    trail: [],
    trips: [],
    layers: {
      places: true,
      routes: true,
      labels: true,
    },
  };
}
// Saves from before the compass mode only had a rotation lock.
// Older saves predate layer visibility; fill any missing fields from defaults.
// Saves from before the manual position was removed may still carry it; drop it.
// Bookmarks and older checkpoints now share the landmark type.
// A draft with no points only survives when the page went away mid-draw; drop it.
// Retired kinds (machinery on 2026-10-12, four more on 2026-10-14, photo on 2026-10-18); old saves and shared files still use them.
// Shaft was retired on 2026-10-12 and came back as a kind of its own on 2026-10-18.
export const legacyMarkerKinds = ["bookmark", "junction", "note", "machinery", "stairs", "squeeze", "dead-end", "new-room", "photo"] as const;
// Retired kinds that clearly became another; the rest become points of interest.
const retiredKindMoves: Partial<Record<(typeof legacyMarkerKinds)[number], MapMarker["kind"]>> = {
  stairs: "passage",
  squeeze: "passage",
  "new-room": "room",
};
// Places saved before descriptions had a plain-text `note` instead.
// Places saved before the unified history had last seen dates.
type StoredMarker = Omit<MapMarker, "kind" | "description"> & {
  kind: MapMarker["kind"] | (typeof legacyMarkerKinds)[number];
  description?: string;
  note?: string;
  lastSeen?: number;
  seenAt?: number;
};
type StoredNavigation = Partial<Omit<NavigationState, "markers" | "trail" | "trips">> & {
  mapId: string;
  markers?: StoredMarker[];
  trail?: unknown;
  trips?: unknown;
  position?: unknown;
  checkpoints?: LegacyCheckpoint[];
  rotationLocked?: boolean;
};
/** Keep saved points and shared files compatible with retired kinds. */
export const normalizeMarkerKind = (kind: StoredMarker["kind"]): MapMarker["kind"] =>
  Object.hasOwn(markerKinds, kind) ? kind as MapMarker["kind"] :
    retiredKindMoves[kind as keyof typeof retiredKindMoves] ?? "landmark";
export function normalizeNavigation(stored: StoredNavigation): NavigationState {
  const defaults = defaultNavigation(stored.mapId);
  const current: StoredNavigation = { ...stored };
  delete current.position;
  delete current.checkpoints;
  delete current.rotationLocked;
  if (!stored.rotationMode && stored.rotationLocked === false) current.rotationMode = "free";
  const layers = { ...defaults.layers };
  for (const name of layerNames)
    if (typeof stored.layers?.[name] === "boolean")
      layers[name] = stored.layers[name];
  const markers = [
    ...(stored.markers ?? []).map(({ note, lastSeen, seenAt, ...marker }): MapMarker => {
      const log = visitFromLastSeen(marker.log, marker.created, lastSeen);
      return {
        ...marker,
        description: marker.description ?? note ?? "",
        kind: normalizeMarkerKind(marker.kind),
        ...(log ? { log } : {}),
      };
    }),
    ...(stored.checkpoints ?? []).map(
      (checkpoint): MapMarker => ({
        id: checkpoint.id,
        point: checkpoint.point,
        label: checkpoint.label,
        description: "",
        kind: "landmark",
        created: checkpoint.confirmed,
      }),
    ),
  ];
  const routes = (stored.routes ?? defaults.routes).filter(
    (route) => !route.draft || route.points.length > 0,
  );
  const trail = Array.isArray(stored.trail) ? stored.trail.filter(isTrailPoint) : [];
  const trips = Array.isArray(stored.trips) ? stored.trips.filter(isTrip) : [];
  return { ...defaults, ...current, markers, routes, trail, trips, layers };
}
// Distinct, high-contrast colors on both black and light maps.
export const routeColors = ["#38d6ff", "#ff6bd6", "#ffd23f", "#7dff8a", "#b18cff"];
export const routeColor = (state: NavigationState, id: string) =>
  routeColors[
    Math.max(0, state.routes.findIndex((route) => route.id === id)) %
      routeColors.length
  ]!;
// Twelve kinds in rows of three: ways in, spaces, hazards, then what people left behind.
export const markerKinds = {
  landmark: { label: t("Point of interest"), color: "#ff9a5c" },
  entrance: { label: t("Entrance"), color: "#7dff8a" },
  shaft: { label: t("Shaft"), color: "#ffd23f" },
  passage: { label: t("Passage"), color: "#3ef0c8" },
  room: { label: t("Room"), color: "#c6f04a" },
  unstable: { label: t("Danger"), color: "#ff4d4d" },
  flooded: { label: t("Flooded"), color: "#5aa9ff" },
  ossuary: { label: t("Ossuary"), color: "#e05bff" },
  sculpture: { label: t("Sculpture"), color: "#eceae4" },
  graffiti: { label: t("Graffiti"), color: "#ff5fa2" },
  tools: { label: t("Tools"), color: "#d9a066" },
  squat: { label: t("Rest area"), color: "#b18cff" },
} as const satisfies Record<string, { label: string; color: string }>;
/** Three steps of water depth, shallowest first; a place stores the step number. */
export const waterLevels = { 1: t("Ankle"), 2: t("Knee"), 3: t("Waist+") } as const;
export type WaterLevel = keyof typeof waterLevels;
export const isWaterLevel = (value: unknown): value is WaterLevel =>
  value === 1 || value === 2 || value === 3;
/** Two steps of danger; a danger place without one is high, as before levels existed. */
export const dangerLevels = { 1: t("Moderate"), 2: t("Severe") } as const;
export type DangerLevel = keyof typeof dangerLevels;
export const isDangerLevel = (value: unknown): value is DangerLevel => value === 1 || value === 2;
export const dangerLevel = (place: Pick<MapMarker, "kind" | "danger">) =>
  place.kind === "unstable" ? place.danger ?? 2 : undefined;
const MODERATE_DANGER_COLOR = "#ff8a1f";
/** A place's pin colour: its kind's, except moderate danger, which is orange. */
export const placeColor = (place: Pick<MapMarker, "kind" | "danger">) =>
  dangerLevel(place) === 1 ? MODERATE_DANGER_COLOR : (markerKinds[place.kind] ?? markerKinds.landmark).color;
export function captureView(camera: Camera, viewport: Size): SavedView {
  return {
    center: screenToWorld(camera, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    }),
    scale: camera.scale,
    rotation: camera.rotation ?? 0,
  };
}
export const restoreView = (view: SavedView, viewport: Size) =>
  cameraAt(view.center, viewport, view.scale, view.rotation);
// Edits use unrotated original pixels. Never infer travel or GPS location from panning.
export function insideImage(point: Point, image: Size) {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= image.width &&
    point.y <= image.height
  );
}
