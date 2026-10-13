import { t } from "../i18n";
import type { Camera, Point, Size } from "./camera";
import { screenToWorld, cameraAt } from "./camera";
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
  created: number;
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
  /** Smart "dark map" mode. Stored under its version 1 name for compatibility. */
  inverted: boolean;
  dimming: number;
  touchLocked: boolean;
  markers: MapMarker[];
  routes: PlannedRoute[];
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
/** marker: tap to drop a new place · route: draw/edit · move: reposition a place */
export type Tool = "browse" | "marker" | "route" | "move";
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
// Kinds that were folded into Landmark (shaft and machinery on 2026-10-12); old saves and shared files still use them.
export const legacyMarkerKinds = ["bookmark", "junction", "note", "shaft", "machinery"] as const;
// Places saved before descriptions had a plain-text `note` instead.
type StoredMarker = Omit<MapMarker, "kind" | "description"> & {
  kind: MapMarker["kind"] | (typeof legacyMarkerKinds)[number];
  description?: string;
  note?: string;
};
type StoredNavigation = Partial<Omit<NavigationState, "markers">> & {
  mapId: string;
  markers?: StoredMarker[];
  position?: unknown;
  checkpoints?: LegacyCheckpoint[];
  rotationLocked?: boolean;
};
/** Keep saved points and shared files compatible with the merged landmark type. */
export const normalizeMarkerKind = (kind: StoredMarker["kind"]): MapMarker["kind"] =>
  Object.hasOwn(markerKinds, kind) ? kind as MapMarker["kind"] : "landmark";
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
    ...(stored.markers ?? []).map(({ note, ...marker }): MapMarker => ({
      ...marker,
      description: marker.description ?? note ?? "",
      kind: normalizeMarkerKind(marker.kind),
    })),
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
  return { ...defaults, ...current, markers, routes, layers };
}
// Distinct, high-contrast colors on both black and light maps.
export const routeColors = ["#38d6ff", "#ff6bd6", "#ffd23f", "#7dff8a", "#b18cff"];
export const routeColor = (state: NavigationState, id: string) =>
  routeColors[
    Math.max(0, state.routes.findIndex((route) => route.id === id)) %
      routeColors.length
  ]!;
export const markerKinds = {
  landmark: { label: t("Landmark"), color: "#ff9a5c" },
  entrance: { label: t("Entrance"), color: "#7dff8a" },
  stairs: { label: t("Stairs"), color: "#ffd23f" },
  squeeze: { label: t("Squeeze"), color: "#3ef0c8" },
  "dead-end": { label: t("Dead end"), color: "#9aa4b2" },
  unstable: { label: t("Unstable"), color: "#ff4d4d" },
  flooded: { label: t("Flooded"), color: "#5aa9ff" },
  graffiti: { label: t("Graffiti"), color: "#ff5fa2" },
  "new-room": { label: t("New room"), color: "#e3e3e3" },
} as const satisfies Record<string, { label: string; color: string }>;
/** Three steps of water depth, shallowest first; a place stores the step number. */
export const waterLevels = { 1: t("Ankle"), 2: t("Knee"), 3: t("Waist+") } as const;
export type WaterLevel = keyof typeof waterLevels;
export const isWaterLevel = (value: unknown): value is WaterLevel =>
  value === 1 || value === 2 || value === 3;
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
