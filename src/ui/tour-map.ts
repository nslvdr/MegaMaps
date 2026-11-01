import { EXAMPLE_SCALE, exampleOcr } from "../example/example-map";
import { crossing, features, METRES_PER_UNIT, PLAN_HEIGHT, PLAN_WIDTH, planMarkup, scaleBar } from "../example/plan";
import { t } from "../i18n";
import { pyramid } from "../processing/pyramid";
import type { PayloadStore } from "../storage/payloads";
import { TILE_SIZE, type MapRecord } from "../types";
import { transformAt, worldToScreen, zoomAt, type Camera, type Point } from "../viewer/camera";
import { searchMap, type MapSearchMatch } from "../viewer/map-search";
import { BRIGHTNESS_LEVELS, DEFAULT_DIMMING, defaultNavigation, type MapMarker, type NavigationState } from "../viewer/navigation";
import { Viewer } from "../viewer/viewer";
import { PLACE_PIN } from "./place-icon";

// The tutorials' map is the app's own viewer showing the example plan, drawn
// into tiles in memory as the viewer asks for them. Gestures are acted out by
// moving its camera along with the finger, and each moment's places, routes,
// trail, tools and search are handed to it the way the app hands them over.

/** The phone's screen is 375×667; at rest the example plan sits this far up and left, one plan unit a pixel. */
const PLAN_OFFSET = { x: 380, y: 330 };
export const on = (x: number, y: number): Point => ({ x, y });
/** Where a point of the plan shows on the screen, with the map at rest. */
const seen = ({ x, y }: Point) => on(Math.round(x - PLAN_OFFSET.x), Math.round(y - PLAN_OFFSET.y));
/** A crossing of the plan's galleries: routes and trails keep to them. */
const at = (i: number, j: number) => seen(crossing(i, j));
/** From the screen at rest to the map's image. */
const world = ({ x, y }: Point) => ({ x: (x + PLAN_OFFSET.x) * EXAMPLE_SCALE, y: (y + PLAN_OFFSET.y) * EXAMPLE_SCALE });

// Map spots, in screen pixels with the map at rest.
export const spot = {
  chatiere: seen(features.chatiere),
  gardien: seen(features.sculpture),
  puits: seen(features.airShaft),
  shared: seen(features.salleZ),
  mark: at(1, -3),
};
const trailPoints = [at(-1, -8), at(-1, -5), at(1, -5)];
export const routePoints = [at(-4, -9), at(-1, -9), at(-1, -4), at(2, -4)];
export const scaleEnds = scaleBar.map(seen);
export const measureEnds = [at(-1, -8), at(-1, -2.5)];

// Places and routes on the example map, newest first like Saved, and the
// show names that put each one there.
type Place = Pick<MapMarker, "id" | "kind" | "label" | "description"> & { at: Point; when?: string };
export const places: Place[] = [
  { id: "tour-salle-z", kind: "room", label: "Salle Z", description: "", at: spot.shared, when: "shared" },
  { id: "tour-chatiere", kind: "passage", label: "Chatière", description: "", at: spot.chatiere, when: "chatiere" },
  { id: "tour-gardien", kind: "sculpture", label: "Le gardien", description: t("A soldier carved into the quarry wall, just past the junction."), at: spot.gardien },
  { id: "tour-puits", kind: "shaft", label: "Puits Lalande", description: "", at: spot.puits },
];
export const gardien = places[2]!;
export const routes = [
  { id: "tour-shared", name: "Vers le puits", when: "shared", points: [spot.shared, at(-3, 1), spot.puits] },
  { id: "tour-route", name: `${t("Route")} 1`, when: "route", points: routePoints },
];

const queries = { query: "Allée 25", "query-pair": "Allée 25; Allée 55" };
const query = (shown: Set<string>) => Object.entries(queries).find(([name]) => shown.has(name))?.[1] ?? "";
const found = new Map<string, MapSearchMatch[]>();
/** What search finds on the example map, the same list each time so the viewer keeps its labels. */
export function tourSearch(text: string) {
  if (!found.has(text)) found.set(text, searchMap(exampleOcr("tour", 0), [], text));
  return found.get(text)!;
}
export const searchText = (show: string) => query(new Set(show.split(" ")));

// Where the camera is: panned, zoomed, turned and moved away, each as a
// finger would leave it. Moving between two blends these, so a pinch closes
// round the fingers and a twist turns round them.
type Pose = { pan: Point; zoom: number; turn: number; away: Point };
const PINCH = on(227, 225);
const TWIST = on(227, 285);
const pose = (shown: Set<string>): Pose => ({
  pan: on(0, shown.has("panned") ? -60 : 0),
  zoom: shown.has("zoomed") ? 0.75 : 1,
  turn: shown.has("turned") ? -24 : 0,
  away: shown.has("away") ? on(80, 240) : on(0, 0),
});
function camera({ pan, zoom, turn, away }: Pose): Camera {
  const rest = { x: pan.x - PLAN_OFFSET.x, y: pan.y - PLAN_OFFSET.y, scale: 1 / EXAMPLE_SCALE };
  const turned = transformAt(zoomAt(rest, rest.scale * zoom, PINCH.x, PINCH.y), rest.scale * zoom, (turn * Math.PI) / 180, TWIST);
  return { ...turned, x: turned.x + away.x, y: turned.y + away.y };
}
const mix = (a: Pose, b: Pose, k: number): Pose => {
  const point = (p: Point, q: Point) => on(p.x + (q.x - p.x) * k, p.y + (q.y - p.y) * k);
  return { pan: point(a.pan, b.pan), zoom: a.zoom * (b.zoom / a.zoom) ** k, turn: a.turn + (b.turn - a.turn) * k, away: point(a.away, b.away) };
};
/** Where a place's pin head shows on screen once `show` is on: what a tap on it touches. */
export function pinOnScreen(show: string, point: Point) {
  const { x, y } = worldToScreen(camera(pose(new Set(show.split(" ")))), world(point));
  return on(Math.round(x), Math.round(y - PLACE_PIN.head));
}

// The example plan as a map record, its tiles drawn from the plan on demand.
const width = PLAN_WIDTH * EXAMPLE_SCALE;
const height = PLAN_HEIGHT * EXAMPLE_SCALE;
const levels = pyramid(width, height);
const record: MapRecord = { id: "tour", name: "Val Moulin", width, height, bytes: 0, backend: "indexeddb", levels, created: 0, status: "ready" };
let plan: string | undefined;
const tiles = new Map<string, Promise<Blob>>();
async function drawTile(key: string) {
  const [level, x, y] = key.replace(".png", "").split("-").map(Number) as [number, number, number];
  const { scale, width, height } = levels[level]!;
  const w = Math.min(TILE_SIZE, width - x * TILE_SIZE), h = Math.min(TILE_SIZE, height - y * TILE_SIZE);
  const unit = scale / EXAMPLE_SCALE;
  plan ??= planMarkup();
  const svg = plan.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
    `viewBox="${x * TILE_SIZE * unit} ${y * TILE_SIZE * unit} ${w * unit} ${h * unit}" width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(w, h);
    image.src = url;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    canvas.getContext("2d")!.drawImage(image, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("tile"))), "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}
const store: PayloadStore = {
  get(_, key) {
    let tile = tiles.get(key);
    if (!tile) {
      tile = drawTile(key);
      tiles.set(key, tile);
      tile.catch(() => tiles.delete(key));
    }
    return tile;
  },
  put: async () => {},
  deleteMap: async () => {},
};

/** What the map holds at a moment: `drawn` cuts the line being tapped out to its first points. */
function navigation(shown: Set<string>): NavigationState {
  const has = (name: string) => shown.has(name);
  const created = Date.now();
  const markers = places.filter((place) => !place.when || has(place.when))
    .map(({ at, when: _, ...place }) => ({ ...place, point: world(at), created }));
  const saved = routes.filter((route) => has(route.when))
    .map(({ points, when: _, ...route }) => ({ ...route, points: points.map(world), created, draft: false }));
  const trail = has("trail") ? [...trailPoints, spot.mark] : has("trail-old") ? trailPoints : [];
  return {
    ...defaultNavigation(record.id),
    metresPerPixel: METRES_PER_UNIT / EXAMPLE_SCALE,
    rotationMode: has("manual") ? "free" : "locked",
    inverted: !has("paper"),
    dimming: has("dim") ? BRIGHTNESS_LEVELS.at(-1)! : DEFAULT_DIMMING,
    markers,
    routes: saved,
    trail: trail.map((point, i) => ({ ...world(point), time: created - (trail.length - i) * 60_000 })),
  };
}

/** A gesture moves the map with the finger; the app glides it as the viewer does. */
export type Move = "jump" | "glide" | "gesture";
const MOVES = { glide: 240, gesture: 900 };
const ease = { glide: (k: number) => 1 - (1 - k) ** 3, gesture: (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2) };
/** A query takes this long to type; it lights up its matches once it's typed out. */
export const TYPING = 800;

/** The viewer on the tutorials' phone, running while a tutorial shows. */
export class TourMap {
  private viewer?: Viewer;
  private show?: { shown: Set<string>; drawn?: number };
  private pose = pose(new Set());
  private motion = 0;
  private typing?: ReturnType<typeof setTimeout>;
  private query = "";
  private observer?: ResizeObserver;
  constructor(private screen: HTMLElement) {}

  private part<T extends Element>(id: string) {
    return this.screen.querySelector<T>(`[data-id="${id}"]`)!;
  }

  /** Starts the viewer once the phone has a size: before, it would fit a blank screen. */
  private start() {
    const canvas = this.part<HTMLCanvasElement>("map-canvas");
    if (this.viewer || typeof ResizeObserver === "undefined" || !canvas.clientWidth) return;
    this.viewer = new Viewer(canvas, record, () => {}, () => {}, {
      navigation: defaultNavigation(record.id),
      overlay: this.part<SVGSVGElement>("map-overlay"),
      searchOverlay: this.part<SVGSVGElement>("search-overlay"),
      onView: () => {},
      onTap: () => {},
      onMarker: () => {},
      store,
    });
    this.query = "";
  }

  /** Shows `show`, the space-separated names of what is on screen, as `move` gets there. */
  display(show: string, move: Move, drawn?: number) {
    this.show = { shown: new Set(show.split(" ")), drawn };
    // The phone may not have its size yet, as the tour opens.
    if (!this.observer && typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => {
        if (!this.viewer) this.apply("jump");
      });
      this.observer.observe(this.part("map-canvas"));
    }
    this.apply(move);
  }

  private apply(move: Move) {
    if (!this.show) return;
    const wasRunning = !!this.viewer;
    this.start();
    const viewer = this.viewer;
    if (!viewer) return;
    if (!wasRunning) move = "jump";
    const { shown, drawn } = this.show;
    const has = (name: string) => shown.has(name);
    // The line being tapped out, one point per tap.
    const line = (points: Point[], on: boolean) => (on ? points.slice(0, drawn ?? points.length) : []).map(world);
    const tool = has("route-tool") ? "route" : has("scale-tool") ? "scale" : has("measure-tool") ? "measure" : has("move-tool") ? "move" : "browse";
    const state = navigation(shown);
    if (tool === "route")
      state.routes.push({ id: "tour-draft", name: routes[1]!.name, points: line(routePoints, has("route-drawing")), created: Date.now(), draft: true });
    viewer.updateNavigation(state);
    viewer.setTool(tool, tool === "route" ? "tour-draft" : tool === "move" ? gardien.id : undefined);
    viewer.setMeasure(tool === "scale" ? line(scaleEnds, has("scale")) : tool === "measure" ? line(measureEnds, has("measure")) : undefined);
    viewer.previewPlace(has("new-place") ? { point: world(spot.chatiere), kind: "passage" } : undefined);
    viewer.select(has("place") || has("edit") ? gardien.id : undefined);

    clearTimeout(this.typing);
    const text = query(shown);
    const search = () => viewer.setSearch(tourSearch(text), !!text, has("next") ? 1 : 0);
    if (text && text !== this.query && move !== "jump") {
      viewer.setSearch([], false);
      this.typing = setTimeout(search, TYPING);
    } else search();
    this.query = text;

    this.moveTo(pose(shown), move);
  }

  private moveTo(target: Pose, move: Move) {
    cancelAnimationFrame(this.motion);
    const from = this.pose, start = performance.now();
    const step = (now: number) => {
      const k = move === "jump" ? 1 : Math.min(1, (now - start) / MOVES[move]);
      this.pose = move === "jump" ? target : mix(from, target, ease[move](k));
      this.viewer?.setView(camera(this.pose));
      if (k < 1) this.motion = requestAnimationFrame(step);
    };
    if (move === "jump") step(start);
    else this.motion = requestAnimationFrame(step);
  }

  /** Lets the viewer go while no tutorial plays; drawn tiles stay for the next one. */
  stop() {
    this.show = undefined;
    clearTimeout(this.typing);
    this.observer?.disconnect();
    this.observer = undefined;
    if (!this.viewer) return;
    cancelAnimationFrame(this.motion);
    this.viewer.dispose();
    this.viewer = undefined;
  }
}
