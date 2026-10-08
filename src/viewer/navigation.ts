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
  note: string;
  kind: "bookmark" | "entrance" | "junction" | "landmark" | "note";
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
export interface NavigationState {
  mapId: string;
  view?: SavedView;
  rotationLocked: boolean;
  /** Smart "dark map" mode. Stored under its version 1 name for compatibility. */
  inverted: boolean;
  dimming: number;
  touchLocked: boolean;
  markers: MapMarker[];
  routes: PlannedRoute[];
  /** Stable imported identities, retained when an imported item is deleted. */
  importedItems?: string[];
  layers: Layers;
}
/** Slightly dimmed by default so routes and places stand out from the map. */
export const DEFAULT_DIMMING = 0.85;
/** marker: tap to drop a new place · route: draw/edit · move: reposition a place */
export type Tool = "browse" | "marker" | "route" | "move";
export function defaultNavigation(mapId: string): NavigationState {
  return {
    mapId,
    rotationLocked: true,
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
// Older saves predate layer visibility; fill any missing fields from defaults.
// Saves from before the manual position was removed may still carry it; drop it.
// Checkpoints were merged into places, so older ones become landmark places.
type StoredNavigation = Partial<NavigationState> & {
  mapId: string;
  position?: unknown;
  checkpoints?: LegacyCheckpoint[];
};
export function normalizeNavigation(stored: StoredNavigation): NavigationState {
  const defaults = defaultNavigation(stored.mapId);
  const current: StoredNavigation = { ...stored };
  delete current.position;
  delete current.checkpoints;
  const layers = { ...defaults.layers };
  for (const name of layerNames)
    if (typeof stored.layers?.[name] === "boolean")
      layers[name] = stored.layers[name];
  const markers = [
    ...(stored.markers ?? []),
    ...(stored.checkpoints ?? []).map(
      (checkpoint): MapMarker => ({
        id: checkpoint.id,
        point: checkpoint.point,
        label: checkpoint.label,
        note: "",
        kind: "landmark",
        created: checkpoint.confirmed,
      }),
    ),
  ];
  return { ...defaults, ...current, markers, layers };
}
// Distinct, high-contrast colors on both black and light maps.
export const routeColors = ["#38d6ff", "#ff6bd6", "#ffd23f", "#7dff8a", "#b18cff"];
export const routeColor = (state: NavigationState, id: string) =>
  routeColors[
    Math.max(0, state.routes.findIndex((route) => route.id === id)) %
      routeColors.length
  ]!;
export const markerKinds = {
  landmark: { label: "Landmark", color: "#ff9a5c" },
  entrance: { label: "Entrance", color: "#7dff8a" },
  junction: { label: "Junction", color: "#ffd23f" },
  bookmark: { label: "Bookmark", color: "#7fb8ff" },
  note: { label: "Note", color: "#e3e3e3" },
} as const satisfies Record<MapMarker["kind"], { label: string; color: string }>;
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
