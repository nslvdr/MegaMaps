import { newId } from "../new-id";
import { flushSync } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { showDialog } from "./dialog";
import type { MapRecord } from "../types";
import { worldToScreen, type Point } from "../viewer/camera";
import type { DarkMode } from "../viewer/appearance";
import { NavigationPersistence, loadNavigation } from "../storage/navigation";
import { loadPhoto, savePhoto } from "../storage/photos";
import { preparePhoto } from "../processing/photo";
import { PhotoViewer } from "./photo-viewer";
import { preserveUnseenImports } from "../sharing/annotations";
import type { Viewer, ViewerOptions } from "../viewer/viewer";
import {
  BRIGHTNESS_LEVELS,
  DEFAULT_DIMMING,
  insideImage,
  markerKinds,
  placeColor,
  routeColor,
  wrapNorth,
  NORTH_MIN,
  type NavigationState,
  type Tool,
  type MapMarker,
  type PlaceLogEntry,
  type PlannedRoute,
  type RotationMode,
  type DangerLevel,
  type WaterLevel,
} from "../viewer/navigation";
import { placesNear, type TrailPoint, type Trip } from "../viewer/trail";
import { lastUpdated, placeChanges, recordEdit } from "../viewer/place-history";
import { allowCompass, compassNeedsPermission, speedDelays, watchCompass, type CompassSpeed } from "../viewer/compass";
import { icons } from "./icons";
import { dayDate, logDate, nextName, plural, timeAgo, updatedAgo } from "./format";
import { errorMessage, locale, t } from "../i18n";
import { preference, setPreference } from "../preferences";
import { orderPlaces, orderRoutes, placeOrders, routeOrders } from "./saved-order";
import { placeIcon } from "./place-icon";
import { wheelChoice, type WheelChoice } from "./hold-wheel";
import type { SheetAction } from "./ActionSheet.svelte";
import { normalizeText, ocrLabelAt, type OcrIndex } from "../ocr/index";
import { matchPoints, searchMap, type MapSearchMatch } from "../viewer/map-search";
import { track } from "../stats";
import { formatDistance, formatMinutes, formatWalk, pathLength, travelSummary } from "../viewer/measure";
import { aheadOf, geoMetresPerPixel, geoNorth, invert, pinGeo, placeGeo, spotsGeo, spotsTooClose, toLonLat, toMercator, type Geo, type Spot } from "../viewer/geo";
import { canLink, LinkRefused, OPEN_SPDR_URL, PositionLink } from "../link/position-link";
import { readVectorFile, shownLinesGeoJson, type VectorLayer } from "../vectors/layer";
import { loadSetting, saveSetting } from "../storage/settings";

export const sheets = ["trail", "display", "rotation", "saved", "add"] as const;
export type Sheet = (typeof sheets)[number] | "search";
/** The place card's Delete and the trail mark's, each armed by a first tap. */
type CardDelete = "marker-delete" | "mark-delete";
type Kind = MapMarker["kind"];
export type SectionMenu = "routes-order" | "places-order";
/** Every passing message is one pill: a tone sets its icon and outline color. */
export const toastIcons = { done: icons.check, quiet: icons.check, removed: icons.trash, error: icons.alert };
export type ToastTone = keyof typeof toastIcons;
type CompassStatus = "off" | "waiting" | "on" | "missing" | "blocked";
/** A row of Saved or Past trips: it opens its item, and ⋯ offers its actions. */
export interface RowItem {
  key: string;
  label: string;
  description?: string;
  /** Shown before the photo count, e.g. a route's points. */
  meta?: string;
  photos?: string[];
  icon: string;
  jump: () => void;
  actions: SheetAction[];
}

/** A day as a date input holds it, in local time. */
const dayValue = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
/** What lifting on each part of the long-press wheel does; back says when there is no mark. */
const wheelLabels: Record<WheelChoice, (marked: boolean) => string> = {
  place: () => t("Add a place"),
  back: (marked) => marked ? t("Go to last mark") : t("No mark yet"),
  trail: () => t("Mark where you are"),
};
/** One mark in a trip's log: when, the place it was near if any, and how far it came. */
export interface TripMark { index: number; time: string; label: string; named: boolean; note: string }
/** "2:05 PM": when a trip started or ended. */
export const clock = (time: number) => new Date(time).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
/** A picked day as a time: today keeps the hour, an earlier day is noon, so it reads the same day anywhere. */
const dayTime = (day: string) => {
  if (day === dayValue(Date.now())) return Date.now();
  const [year, month, date] = day.split("-").map(Number);
  return Math.min(Date.now(), new Date(year!, month! - 1, date, 12).getTime());
};
const copyPoints = (points: Point[]) => points.map((point) => ({ ...point }));
const SEARCH_DEBOUNCE_MS = 200;
export const rotationModes: Record<RotationMode, { icon: string; label: string }> = {
  free: { icon: icons.freeRotation, label: t("Manual") },
  compass: { icon: icons.compass, label: t("Compass") },
  locked: { icon: icons.rotationLock, label: t("Locked") },
};
/** How long a new heading must hold before the map turns to it; Tap waits for a double tap. */
const followDelay = () =>
  preference("compass-follow") === "tap" ? undefined : speedDelays[preference("compass-speed")];
const COMPASS_WAIT_MS = 3000;
/** Compass mode leaves turns smaller than this, in degrees, alone… */
const COMPASS_STEP = 2;
/** …and waits for readings to hold within this many degrees of their average. */
const COMPASS_HOLD = 15;
/** How loosely a mark corrects a linked app: the user is near there, not on the spot. */
const MARK_ACCURACY_METRES = 10;
/** How far a position app's estimate moves before it adds to the trip. */
const LIVE_SPACING_METRES = 10;
const MAX_VECTOR_BYTES = 64 * 2 ** 20;
/** What one step of the Calibrate rulers changes: the map's size by a twentieth of a percent, its turn by a twentieth of a degree. */
const SCALE_STEP = 0.0005, TURN_STEP = (0.05 * Math.PI) / 180;
/** Height of one north wheel row, as the wheel draws it. */
export const NORTH_ROW_PX = 32;
const darkMessages: Record<DarkMode["kind"], string> = {
  inverted: t("Colors inverted on pure black"),
  deepened: t("Background deepened to black"),
  "already-dark": t("Map is already dark"),
};

// Owns map tools, panels and cards and saves what they change; the renderer
// only knows coordinates and appearance. What shows comes from its state: the
// map's saved navigation is read again each time `tick` moves.
export class ViewerControls {
  private viewer?: Pick<Viewer, "setTool" | "updateNavigation" | "jumpTo" | "fitPoints"> &
    Partial<Pick<Viewer, "setLive" | "setMeasure" | "moveStreets" | "streetsCenter" | "streetsScale" | "markSpot" | "restyle" | "orient" | "straighten" | "setSearch" | "refreshLabels" | "previewPlace" | "pulse" | "reveal" | "showing" | "cover" | "select" | "showTrip" | "showView">>;
  /** Bumped whenever the saved navigation changes, so whatever shows it is worked out again. */
  tick = $state(0);
  tool = $state<Tool>("browse");
  openSheet = $state<Sheet>();
  /** The Trail tool is moving the last mark rather than adding one. */
  movingMark = $state(false);
  /** Where the map lay before lining up began, for × (cancel). */
  private geoBefore?: Geo;
  /** The spots matched so far, on the map and on the streets. */
  spots = $state.raw<Spot[]>([]);
  /** What the rulers turn and resize the map about. */
  private pivot?: Spot;
  /** The rulers changed the map's scale or turn. */
  private adjusted = false;
  /** How the search or the last spot went, shown instead of the hint. */
  matchMessage = $state("");
  /** The town or street being searched for. */
  placeQuery = $state("");
  /** The task card's height: the map and the streets share what's above it. */
  toolHeight = $state(0);
  /** A Delete or × waiting for its second tap. */
  confirming = $state<string>();
  cardDeleteArmed = $state<CardDelete>();
  /** The X armed to discard a form's typing on its second tap. */
  discarding = $state<string>();
  compass = $state<CompassStatus>("off");
  darkKind = $state<DarkMode["kind"]>("inverted");
  /** How Saved lists places and routes, kept for the device. */
  placeOrder = $state(preference("place-order"));
  routeOrder = $state(preference("route-order"));
  /** The kinds of place Saved shows, only while the map is open; none shows every kind. */
  placeKinds = new SvelteSet<Kind>();
  /** The open ⋯ sheet's row, or the open section menu. */
  rowMenu = $state<string>();
  /** What the last ⋯ sheet showed, kept while it leaves. */
  rowSheet = $state.raw<{ key: string; title: string; detail?: string; icon: string; actions: SheetAction[] }>();
  /** The last section menu shown, kept while it leaves. */
  menu = $state<SectionMenu>();
  /** Bumped once a panel has risen into place, so its menu goes where it ended up. */
  settled = $state(0);
  toast = $state({ message: "", tone: "done" as ToastTone, shown: false });
  toastUndo = $state.raw<() => void>();
  ocrProgress = $state.raw<{ percent: number; left: string }>();
  ocr = $state.raw<OcrIndex>();
  ocrMessage = $state("");
  /** The search field as typed, and what was last searched for. */
  query = $state("");
  searchQuery = $state("");
  searchMatches = $state.raw<MapSearchMatch[]>([]);
  searchPosition = $state(-1);
  /** The place card reads an item, or edits one in its form. */
  cardMode = $state<"view" | "edit">("view");
  cardTitle = $state("");
  /** Keep the detail view available while its place or route is being edited. */
  viewingMarker = $state<string>();
  viewingRoute = $state<string>();
  editingMarker = $state<string>();
  /** The route whose name, description and photos are in the form. */
  editingRoute = $state<string>();
  /** Where the place being added or edited shows through the card's scrim. */
  spot = $state.raw<Point>();
  formLabel = $state("");
  formDescription = $state("");
  formKind = $state<Kind>("landmark");
  /** The water level picked in the form; kept only if the place is saved as flooded. */
  formWater = $state<WaterLevel>();
  /** The danger level picked in the form; kept only if the place is saved as danger. */
  formDanger = $state<DangerLevel>(2);
  /** Photos in the form, saved with the item on Save. */
  formPhotos = $state.raw<string[]>([]);
  /** The history in the place form; entries removed here are deleted on Save. */
  formLog = $state.raw<PlaceLogEntry[]>([]);
  photoJobs = $state(0);
  /** Printed map text under the place being added, which names it better than its kind. */
  mapLabel = $state<string>();
  /** The trail mark's card shows Move and Delete after Edit. */
  markActions = $state(false);
  markTime = $state("");
  /** The past trip whose summary is open. */
  viewingTrip = $state<string>();
  /** That summary shows every mark, and which one the map is on. */
  tripLogOpen = $state(false);
  tripMark = $state<number>();
  nameTitle = $state("");
  nameValue = $state("");
  scaleMetresValue = $state<number | null | undefined>(null);
  entryDate = $state("");
  entryText = $state("");
  /** The long-press wheel, under the finger. */
  wheel = $state({ shown: false, x: 0, y: 0, marked: false, choice: undefined as WheelChoice | undefined, label: "" });
  /** The time Trail's clock counts from, updated each minute. */
  clockNow = $state(Date.now());

  private searchTimer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();
  /** What this stretch on the map did, sent as one event when it ends. */
  private visit = ViewerControls.newVisit();
  private persistence: NavigationPersistence;
  private activeRoute?: string;
  /** Points before editing began; undefined when the route is new. */
  private routeBefore?: Point[];
  /** The route as it was when editing began, for × (cancel). */
  private routeStart?: { points: Point[]; draft: boolean };
  /** Undo steps for the route being drawn: its points before each tap or drag. */
  private routeHistory: Point[][] = [];
  private dragBefore?: Point[];
  /** The line being measured; it waits while the scale is set, and goes when Measure closes. */
  private measurePoints: Point[] = [];
  /** The two ends of a known length, while the scale is set. */
  private scalePoints: Point[] = [];
  /** Undo steps for the measure or scale line: its points before each tap or drag. */
  private measureHistory: Point[][] = [];
  /** The place being moved, and where it was. */
  private movingMarker?: string;
  private moveFrom?: Point;
  /** Editing holds focus in the details card; reading leaves the map usable. */
  private cardModal = false;
  private reopeningCard = false;
  private markerPoint?: Point;
  private nameAction?: (name: string) => void;
  private toastTimer?: ReturnType<typeof setTimeout>;
  /** Move (a place) or Edit points (a route) saves the form first. */
  private moveAfterSave = false;
  private discardTimer?: ReturnType<typeof setTimeout>;
  /** The edit form as it opened, to tell whether X would throw anything away. */
  private formStart = "";
  private cardDeleteTimer?: ReturnType<typeof setTimeout>;
  private confirmTimer?: ReturnType<typeof setTimeout>;
  private tripClockTimer?: ReturnType<typeof setTimeout>;
  /** New places start as the kind last saved, for runs of entrances or notes. */
  private newMarkerKind: Kind = "landmark";
  /** Bumped per form so a photo still being prepared can't land on another place. */
  private formVersion = 0;
  /** Object URLs for the open card, revoked when it closes. */
  private photoURLs = new Map<string, Promise<string | undefined>>();
  private photoViewer?: PhotoViewer;
  /** The heading the map is turned to, in degrees from north. */
  private heading?: number;
  /** Where the top of the phone points now, in degrees from north. */
  private reading?: number;
  private stopWatching?: () => void;
  /** Bumped on every start and stop, so a late permission answer is ignored. */
  private compassRun = 0;
  constructor(
    private root: HTMLElement,
    private map: MapRecord,
    readonly state: NavigationState,
    readonly onShare?: (item?: { kind: "marker" | "route"; id: string }) => void,
  ) {
    this.persistence = new NavigationPersistence(
      () => this.state,
      () => this.showToast(t("Could not save. Free some device storage."), "error"),
    );
    // Touch lock is no longer offered; never restore one from an older save.
    this.state.touchLocked = false;
    // Older slider values use the nearest available preset.
    this.state.dimming = BRIGHTNESS_LEVELS.reduce(
      (closest, level) => Math.abs(level - state.dimming) < Math.abs(closest - state.dimming) ? level : closest,
      DEFAULT_DIMMING,
    );
    this.bind();
    this.refresh();
    if (state.rotationMode === "compass") this.resumeCompass();
    if (this.canLink) void loadSetting("position-link").then((on) => {
      if (on && !this.controller.signal.aborted) this.link.connect();
    }).catch(() => {});
  }
  private static newVisit() {
    return { started: Date.now(), searched: false, measured: false, trip: false, place_added: false };
  }
  /** Leaving the app ends a visit as well as going back, since phones rarely go back. */
  private endVisit() {
    const { started, ...used } = this.visit;
    track("map_viewed", { seconds: Math.round((Date.now() - started) / 1000), ...used });
  }
  private open(item: MapMarker | PlannedRoute, from: "map" | "saved") {
    if ("label" in item) track("place_opened", { kind: item.kind, photos: item.photos?.length ?? 0, from });
    else track("route_opened", { points: item.points.length, from });
    this.showDetails(item);
  }
  /** iOS forgets compass access when the app closes and only asks again from a tap,
   *  so a map reopened in Compass mode asks on the first tap anywhere. */
  private resumeCompass() {
    void this.startCompass(false);
    if (!compassNeedsPermission()) return;
    const ask = () => {
      if (this.state.rotationMode === "compass" && this.compass !== "on") void this.startCompass(true);
    };
    window.addEventListener("touchend", ask, { once: true, capture: true, signal: this.controller.signal });
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return this.root.querySelector<T>(`#${id}`) ?? undefined;
  }
  private dialog(id: string) {
    return this.el<HTMLDialogElement>(id);
  }
  private close(id: string) {
    this.dialog(id)?.close();
  }
  private isOpen(id: string) {
    return !!this.dialog(id)?.hasAttribute("open");
  }
  /** Shows a dialog once what it says is on the page. */
  private show(id: string, modal = true) {
    flushSync();
    const dialog = this.dialog(id);
    if (dialog) showDialog(dialog, modal);
    return dialog;
  }
  private on(target: EventTarget, type: string, action: (event: Event) => void) {
    target.addEventListener(type, action, { signal: this.controller.signal });
  }
  options(): ViewerOptions {
    return {
      navigation: this.state,
      overlay: this.root.querySelector<SVGSVGElement>("#map-overlay")!,
      searchOverlay: this.root.querySelector<SVGSVGElement>("#search-overlay")!,
      streetCanvas: this.root.querySelector<HTMLCanvasElement>("#street-canvas")!,
      onView: () => {
        this.persistence.moved();
      },
      onTap: (point) => this.onTap(point),
      onMarker: (marker) => this.open(marker, "map"),
      onRoute: (route) => this.open(route, "map"),
      onEmptyTap: () => this.closePlaceDetails(),
      onDoubleTap: () => this.orientOnTap(),
      // A result's label flies to that result, like stepping to it.
      onSearchResult: (index) => this.showMatch(index),
      // Long-press opens a wheel under the finger: drag up-left and lift to add
      // a place there, up-right to go back to the last mark, down to mark the
      // trail; lifting in the middle does nothing.
      onHold: (point, screen) => {
        if (this.tool !== "browse") return;
        const marked = this.state.trail.length > 0;
        Object.assign(this.wheel, { shown: true, x: screen.x, y: screen.y, marked, choice: undefined, label: "" });
        // Without a mark, back is named but never lit, so lifting there does nothing.
        const choiceAt = (at: Point) => {
          const choice = wheelChoice(screen, at);
          return choice === "back" && !marked ? undefined : choice;
        };
        return {
          move: (at) => {
            const aimed = wheelChoice(screen, at);
            this.wheel.choice = choiceAt(at);
            this.wheel.label = aimed ? wheelLabels[aimed](marked) : "";
          },
          end: (at) => {
            this.wheel.shown = false;
            const choice = at && choiceAt(at);
            if (choice === "place") this.openMarker(t("New place"), point);
            else if (choice === "back") this.backToMark();
            else if (choice === "trail") this.markTrail(point);
          },
        };
      },
      onTrailMark: () => this.showMark(),
      onDragStart: () => {
        const line = this.measuring() ? this.tape() : this.tool === "route" ? this.route()?.points : undefined;
        this.dragBefore = line && copyPoints(line);
      },
      onDrop: (moved) => {
        const measuring = this.measuring();
        if (moved && this.dragBefore) (measuring ? this.measureHistory : this.routeHistory).push(this.dragBefore);
        this.dragBefore = undefined;
        if (moved && measuring) this.measured();
        else if (moved) this.changed();
      },
      onAppearance: (mode) => {
        this.darkKind = mode.kind;
      },
    };
  }
  attach(viewer: NonNullable<ViewerControls["viewer"]>) {
    this.viewer = viewer;
    this.query = "";
    this.renderSearch();
    this.refresh();
  }
  /** Saves an edit and shows it; `restyled` when only the look or the layers changed. */
  private changed(restyled = false) {
    this.persistence.changed();
    if (restyled && this.viewer?.restyle) this.viewer.restyle();
    else this.viewer?.updateNavigation(this.state);
    if (this.openSheet === "search" && !this.searchTimer) this.renderSearch();
    this.refresh();
  }
  /** Shows the saved navigation again. */
  private refresh() {
    // Kinds no longer saved here drop out, so the filter can't hide every place,
    // and with its menu gone below two places, the filter goes too.
    const kinds = this.savedKinds();
    for (const kind of [...this.placeKinds])
      if (!kinds.includes(kind) || this.state.markers.length < 2) this.placeKinds.delete(kind);
    // Ordering needs two items, so a section's menu goes with its second item.
    if ((this.rowMenu === "routes-order" && this.state.routes.length < 2) ||
        (this.rowMenu === "places-order" && this.state.markers.length < 2)) this.rowMenu = undefined;
    this.renderTripClock();
    this.tick++;
    this.viewer?.refreshLabels?.();
  }
  showToast(message: string, tone: ToastTone, undo?: () => void) {
    Object.assign(this.toast, { message, tone, shown: true });
    this.toastUndo = undo;
    clearTimeout(this.toastTimer);
    // Long hints stay up longer: 50 ms a character (a word in about 0.3 s), up
    // to 6 s, which is also how long an Undo stays on offer.
    this.toastTimer = setTimeout(() => this.hideToast(), undo ? 6000 : Math.min(6000, 1500 + message.length * 50));
  }
  private hideToast() {
    this.toast.shown = false;
    this.toastUndo = undefined;
  }
  undoToast() {
    this.toastUndo?.();
  }
  /** The trail grows by one point, and the first starts a trip; a mistaken one
   * can be taken back from the toast. */
  private markTrail(point: Point) {
    const view = this.markedView();
    const mark: TrailPoint = { ...point, time: Date.now(), ...(view && { view }) };
    // A card about the old last mark would now be about the wrong one.
    this.close("mark-dialog");
    this.state.trail.push(mark);
    this.changed();
    this.sendMark(mark);
    // With trip_ended, tells trips left running from Trail opened only to look.
    if (this.state.trail.length === 1) track("trip_started");
    this.showToast(this.state.trail.length > 1 ? t("Trail point added") : t("Trip started"), "done", () => {
      this.state.trail = this.state.trail.filter((other) => other.time !== mark.time);
      this.changed();
      this.showToast(t("Trail point removed"), "quiet");
    });
  }
  /** Where the map is and how far in, for coming back to it later. */
  private markedView() {
    const view = this.state.view;
    return view && { center: { ...view.center }, scale: view.scale };
  }
  /** The map as it was when a point was marked; older marks only center. */
  private backToMark(mark = this.state.trail.at(-1)) {
    if (!mark) return;
    if (mark.view && this.viewer?.showView) this.viewer.showView(mark.view);
    else this.viewer?.jumpTo(mark);
  }
  /** Trail's Last mark, or any mark in its list: the panel makes way for the map. */
  backFromPanel(index = this.state.trail.length - 1) {
    this.sheet(undefined);
    this.backToMark(this.state.trail[index]);
  }
  /** The red dot, read first: when it was marked. Edit offers Move and Delete. */
  private showMark() {
    const last = this.state.trail.at(-1);
    if (!last) return;
    this.closePlaceDetails();
    this.sheet(undefined);
    this.markTime = t("Marked {when}", { when: timeAgo(last.time, Date.now()) });
    this.markActions = false;
    this.armCardDelete();
    const card = this.show("mark-dialog", false);
    if (card) this.viewer?.reveal?.(last, card.offsetTop);
  }
  toggleMarkActions() {
    this.markActions = !this.markActions;
    this.armCardDelete();
  }
  /** The next tap on the map puts the last mark there instead. */
  moveMark() {
    this.close("mark-dialog");
    this.movingMark = true;
    this.mode("trail");
  }
  private placeMark(point: Point) {
    const trail = this.state.trail, before = trail.at(-1);
    if (!before) return;
    const view = this.markedView();
    const moved: TrailPoint = { ...before, ...point, ...(view && { view }) };
    trail[trail.length - 1] = moved;
    this.changed();
    this.showToast(t("Mark moved"), "done", () => {
      this.state.trail = this.state.trail.map((other) => other === moved ? before : other);
      this.changed();
      this.showToast(t("Mark not moved"), "quiet");
    });
  }
  /** Two taps: the first arms Delete briefly. */
  deleteMarkTap() {
    if (this.cardDeleteArmed !== "mark-delete") return this.armCardDelete("mark-delete");
    this.armCardDelete();
    const last = this.state.trail.at(-1);
    if (!last) return;
    this.close("mark-dialog");
    this.state.trail = this.state.trail.slice(0, -1);
    this.changed();
    this.showToast(t("Trail point removed"), "removed", () => {
      this.state.trail = [...this.state.trail, last].sort((a, b) => a.time - b.time);
      this.changed();
      this.showToast(t("Trail point restored"), "done");
    });
  }
  /** Ending a trip keeps it in Past trips and shows how it went. A single point
   * never went anywhere, so it just ends. Either way it can be taken back. */
  endTrip() {
    const points = this.state.trail;
    if (!points.length) return;
    const trip = points.length > 1 ? { id: newId(), points, ended: Date.now() } : undefined;
    this.close("mark-dialog");
    this.state.trail = [];
    this.liveTripEnded = this.link.status === "connected" && !!this.link.state?.running;
    if (trip) {
      this.state.trips.push(trip);
      track("trip_ended", { minutes: Math.round((trip.ended - points[0]!.time) / 60_000), points: points.length });
      this.visit.trip = true;
    }
    this.sheet(undefined);
    this.changed();
    if (trip) this.showTrip(trip);
    this.showToast(t("Trip ended"), trip ? "done" : "removed", () => {
      if (trip) this.state.trips = this.state.trips.filter((other) => other.id !== trip.id);
      if (trip && this.viewingTrip === trip.id) this.close("trip-dialog");
      this.state.trail = points;
      this.changed();
      this.showToast(t("Trip restored"), "done");
    });
  }
  /** A past trip, whole on the map above a card of how far and how long. */
  private showTrip(trip: Trip) {
    this.closePlaceDetails();
    this.viewingTrip = trip.id;
    this.tripLogOpen = false;
    this.tripMark = undefined;
    this.show("trip-dialog", false);
    this.frameTrip(trip);
  }
  /** The whole trip in the room its card leaves. */
  private frameTrip(trip: Trip) {
    flushSync();
    const card = this.dialog("trip-dialog");
    this.viewer?.showTrip?.(trip.points);
    if (card) this.viewer?.cover?.(card.offsetTop);
    this.viewer?.fitPoints(trip.points);
  }
  /** The card folds its marks open or shut, and the map refits above it. */
  toggleTripLog() {
    const trip = this.viewedTrip();
    if (!trip) return;
    this.tripLogOpen = !this.tripLogOpen;
    this.tripMark = undefined;
    this.frameTrip(trip);
  }
  /** A row of the trip's log finds its mark on the map. */
  pickTripMark(index: number) {
    const trip = this.viewedTrip(), mark = trip?.points[index];
    if (!trip || !mark) return;
    this.tripMark = index;
    this.viewer?.showTrip?.(trip.points, mark);
    this.viewer?.jumpTo(mark);
  }
  renameTrip() {
    const trip = this.viewedTrip();
    if (trip) this.name(t("Rename trip"), this.tripTitle(trip), (name) => {
      trip.name = name;
      this.changed();
    });
  }
  /** Its id ties a route to the trip it came from, so a trip is saved only once. */
  private routeId = (trip: Trip) => `trip-${trip.id}`;
  /** A trip walked is a way to walk again: its marks become a route, for Saved. */
  saveTripRoute() {
    const trip = this.viewedTrip();
    if (!trip) return;
    const id = this.routeId(trip);
    if (this.state.routes.some((route) => route.id === id)) return;
    const points = trip.points.map(({ x, y }) => ({ x, y }));
    const name = this.tripName(trip);
    this.state.routes.push({ id, name, points, created: Date.now(), draft: false });
    track("route_saved", { points: points.length, edited: false });
    this.changed();
    this.showToast(t("{name} saved · {points}", { name, points: plural(points.length, "point") }), "done", () => {
      this.state.routes = this.state.routes.filter((route) => route.id !== id);
      this.changed();
      this.showToast(t("Route removed"), "quiet");
    });
  }
  /** The trip whose card is open. */
  viewedTrip() {
    return this.state.trips.find((trip) => trip.id === this.viewingTrip);
  }
  /** The trip leaves the map with its card. Closing to show another trip
   * reopens the card before this runs, so it is left alone. */
  tripClosed() {
    if (this.controller.signal.aborted || this.isOpen("trip-dialog")) return;
    this.viewingTrip = undefined;
    this.viewer?.showTrip?.();
    if (!this.isOpen("marker-dialog")) this.viewer?.cover?.();
  }
  tripName(trip: Trip) {
    return trip.name ?? t("Trip {date}", { date: logDate(trip.points[0]!.time) });
  }
  /** On its card, the year stands under the title to leave room for Edit. */
  private tripTitle(trip: Trip) {
    return trip.name ?? t("Trip {date}", { date: dayDate(trip.points[0]!.time) });
  }
  /** What the finished trip's card reads. Distance and pace need a scale, and
   * places a place passed; without any, Marks keeps the cell from saying 0. */
  tripCard(trip: Trip) {
    const start = trip.points[0]!, scale = this.state.metresPerPixel;
    const passed = [...new Set(placesNear(trip.points, this.state.markers, scale).filter((name) => name !== undefined))];
    const metres = scale ? pathLength(trip.points) * scale : undefined, hours = (trip.ended - start.time) / 3_600_000;
    const times = `${clock(start.time)} – ${clock(trip.ended)}`;
    return {
      title: this.tripTitle(trip),
      times: `${trip.name ? logDate(start.time) : new Date(start.time).getFullYear()} · ${times}`,
      stats: [
        ...(metres !== undefined ? [{ id: "trip-distance", icon: icons.measure, label: t("Distance"), value: formatDistance(metres) }] : []),
        { id: "trip-duration", icon: icons.timer, label: t("Time"), value: formatMinutes(Math.round(hours * 60)) },
        ...(metres !== undefined ? [{ id: "trip-pace", icon: icons.pace, label: t("Pace"), value: hours ? t("{distance}/h", { distance: formatDistance(metres / hours) }) : "–" }] : []),
        passed.length
          ? { id: "trip-places", icon: icons.places, label: t("Places"), value: String(passed.length) }
          : { id: "trip-count", icon: icons.pin, label: t("Marks"), value: String(trip.points.length) },
      ],
      marks: plural(trip.points.length, "mark"),
      passed: passed.join(", "),
      saved: this.state.routes.some((route) => route.id === this.routeId(trip)),
    };
  }
  /** A trip's marks in order; the last of a finished one is where it ended. */
  tripMarks(points: TrailPoint[], finished: boolean) {
    const scale = this.state.metresPerPixel, places = placesNear(points, this.state.markers, scale);
    return points.map((point, index): TripMark => {
      const previous = points[index - 1];
      return {
        index,
        time: clock(point.time),
        label: places[index] ?? (finished && index === points.length - 1 ? t("End") : t("Mark {number}", { number: index + 1 })),
        named: !!places[index],
        note: !previous ? t("Start") : scale ? `+${formatDistance(pathLength([previous, point]) * scale)}` : "",
      };
    });
  }
  /** Deletes stay two taps, and a few seconds to change your mind after. */
  private deleted(label: string, restore: () => void) {
    this.showToast(t("{name} deleted", { name: label }), "removed", () => {
      restore();
      this.changed();
      this.showToast(t("{name} restored", { name: label }), "done");
    });
  }
  /** Opens a panel, or Search, in the pill's place; undefined brings the pill back. */
  sheet(name: Sheet | undefined) {
    const previous = this.openSheet;
    if (previous === "search" && name !== "search") {
      if (normalizeText(this.searchQuery)) {
        // Never the words themselves: whether the map's text was searchable and how long the
        // search was tell a map left unscanned from text the search missed.
        track("search_used", { results: this.searchMatches.length, places: this.searchMatches.some((match) => match.marker),
          scanned: !!this.ocr, words: normalizeText(this.searchQuery).split(" ").length });
        this.visit.searched = true;
      }
      this.el("map-search")?.blur();
      this.query = "";
      this.renderSearch();
    }
    this.openSheet = name;
    if (name && name !== previous) track("panel_opened", { panel: name });
    // A panel replaces the place being read.
    if (name) this.closePlaceDetails();
    // Row menus start closed each time a panel opens.
    if (name !== previous) this.closeRowMenu();
    flushSync();
    const content = this.el("sheet-content");
    if (content) content.scrollTop = 0;
    // A hidden wheel cannot scroll, so it finds its degree once it shows.
    if (name === "rotation") this.syncNorthWheel();
    this.viewer?.refreshLabels?.();
  }
  /** A panel's button opens it, or closes it when it's the one open. */
  toggleSheet(name: (typeof sheets)[number]) {
    this.sheet(this.openSheet === name ? undefined : name);
  }
  /** Opens Search ready to type. */
  openSearch() {
    if (this.tool !== "browse" || this.modalOpen()) return;
    this.sheet("search");
    this.el("map-search")?.focus();
  }
  /** Next match. Search puts the keyboard away, so the count steps on from there. */
  stepSearch() {
    if (this.openSheet === "search") this.focusSearch(this.searchPosition < 0 ? 0 : 1);
  }
  /** The on-screen keyboard's Search key goes to the first match. */
  searchKey(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    this.stepSearch();
  }
  mode(tool: Tool) {
    if (tool !== "trail") this.movingMark = false;
    this.tool = tool;
    this.viewer?.setTool(tool, tool === "move" ? this.movingMarker : this.activeRoute);
    this.viewer?.setMeasure?.(this.measuring() ? this.tape() : undefined);
    this.sheet(undefined);
  }
  private name(title: string, initial: string, action: (name: string) => void) {
    this.nameAction = action;
    this.nameTitle = title;
    this.nameValue = initial;
    this.show("name-dialog");
    // Ready to type over the name; a tap places the cursor instead.
    const input = this.el<HTMLInputElement>("name-input");
    input?.focus();
    input?.select();
  }
  saveName() {
    const name = this.nameValue.trim();
    if (!name) return;
    this.close("name-dialog");
    this.nameAction?.(name);
    this.nameAction = undefined;
  }
  /** A new place's name field starts empty, hinting the name it gets if left so. */
  get namePlaceholder() {
    return this.editingMarker || this.editingRoute ? "" : this.mapLabel ?? markerKinds[this.formKind].label;
  }
  private markerLabel() {
    return this.formLabel.trim() || this.namePlaceholder;
  }
  /** Save waits for a name and for photos still being prepared. */
  get canSave() {
    return this.photoJobs === 0 && !!this.markerLabel();
  }
  /** Places and routes share one form: a name, a description and photos. */
  private openForm(
    title: string,
    fields: { id?: string; name: string; description?: string; photos?: string[] },
    route?: PlannedRoute,
  ) {
    // Cancel goes back to the details only when they are this item's.
    if (!fields.id || fields.id !== (this.viewingMarker ?? this.viewingRoute))
      this.viewingMarker = this.viewingRoute = undefined;
    this.cardMode = "edit";
    this.cardTitle = title;
    this.editingRoute = route?.id;
    this.formLabel = fields.name;
    this.formDescription = fields.description ?? "";
    this.armCardDelete();
    this.formVersion++;
    this.formPhotos = [...(fields.photos ?? [])];
    this.formLog = [];
  }
  private openMarker(title: string, point: Point, marker?: MapMarker) {
    this.editingMarker = marker?.id;
    this.markerPoint = point;
    const kind = marker?.kind ?? this.newMarkerKind;
    this.mapLabel = marker ? undefined : ocrLabelAt(this.ocr, point);
    this.openForm(title, { ...marker, name: marker?.label ?? "" });
    this.formKind = kind;
    this.formWater = marker?.water;
    this.formDanger = marker?.danger ?? 2;
    this.formLog = [...marker?.log ?? []];
    // A new place shows where it will go while it is named.
    if (!marker) {
      this.viewer?.select?.();
      this.viewer?.previewPlace?.({ point, kind });
    }
    this.presentCard(true);
    this.viewer?.cover?.();
    if (marker) this.viewer?.jumpTo(point, 1);
    // The card covers the bottom of the map; keep the place it's about in sight,
    // lit through the scrim.
    const card = this.dialog("marker-dialog");
    this.spot = card && this.viewer?.reveal?.(point, card.offsetTop);
  }
  /** Lets go of the photos the card showed. */
  private releasePhotos() {
    for (const url of this.photoURLs.values()) void url.then((url) => url && URL.revokeObjectURL(url));
    this.photoURLs.clear();
  }
  /** A stored photo as a URL to show, or undefined when it can't be read. */
  photoURL(id: string) {
    let url = this.photoURLs.get(id);
    if (!url) {
      url = loadPhoto(this.map.id, id).then((blob) => blob && URL.createObjectURL(blob), () => undefined);
      this.photoURLs.set(id, url);
    }
    return url;
  }
  /** Full screen, swiping through the item's photos from the one tapped. */
  showPhotos(ids: string[], index: number) {
    const dialog = this.dialog("photo-viewer");
    if (!dialog) return;
    this.photoViewer ??= new PhotoViewer(dialog, this.controller.signal);
    this.photoViewer.show(ids.map((id, i) => {
      const image = document.createElement("img");
      image.alt = t("Photo {number} of {total}", { number: i + 1, total: ids.length });
      image.decoding = "async";
      void this.photoURL(id).then((url) => {
        if (url) image.src = url;
        else image.parentElement?.remove();
      });
      return image;
    }), index);
  }
  removePhoto(id: string) {
    this.formPhotos = this.formPhotos.filter((photo) => photo !== id);
  }
  removeLogEntry(entry: PlaceLogEntry) {
    this.formLog = this.formLog.filter((other) => other !== entry);
  }
  /** What the edit form holds, compared with how it opened. */
  private formState() {
    return JSON.stringify([this.formLabel, this.formDescription, this.formKind, this.formWater, this.formDanger,
      this.formPhotos, this.formLog.map((entry) => entry.id)]);
  }
  /** X on a form with work in it asks once: it fills red, and a second tap discards. */
  private confirmDiscard(id: string, dirty: boolean) {
    if (dirty && this.discarding !== id) {
      this.armDiscard(id);
      return false;
    }
    this.armDiscard();
    return true;
  }
  private armDiscard(id?: string) {
    this.discarding = id;
    clearTimeout(this.discardTimer);
    if (id) this.discardTimer = setTimeout(() => this.armDiscard(), 3000);
  }
  /** Opens on today, ready to type a note; Add with none records a visit. */
  openLogEntry() {
    this.entryDate = dayValue(Date.now());
    this.entryText = "";
    this.armDiscard();
    this.show("entry-dialog");
    this.el("entry-text")?.focus();
  }
  cancelEntry() {
    if (this.confirmDiscard("entry-cancel", !!this.entryText.trim())) this.close("entry-dialog");
  }
  addEntry() {
    const place = this.viewedItem();
    const text = this.entryText.trim(), day = this.entryDate;
    if (!place || !("label" in place) || !day) return;
    place.log = [...place.log ?? [], { id: newId(), date: dayTime(day), ...(text ? { text } : {}) }];
    this.close("entry-dialog");
    this.changed();
    this.showDetails(place);
    this.showToast(t(text ? "Note added to {name}" : "Visit added to {name}", { name: place.label }), "done");
  }
  /** The latest day a visit can be logged for. */
  get today() {
    return dayValue(Date.now());
  }
  /** Photos are shrunk and stored as they are picked; the item keeps them on Save. */
  async addPhotos(files: File[]) {
    const version = this.formVersion;
    this.photoJobs++;
    let failed = 0;
    try {
      for (const file of files) {
        try {
          const id = await savePhoto(this.map.id, await preparePhoto(file));
          if (version !== this.formVersion) return;
          this.formPhotos = [...this.formPhotos, id];
        } catch {
          failed++;
        }
      }
    } finally {
      this.photoJobs--;
    }
    if (failed) this.showToast(failed === files.length && failed === 1
      ? t("This photo could not be added.") : t("{photos} could not be added.", { photos: plural(failed, "photo") }), "error");
  }
  private onTap(point: Point) {
    if (!insideImage(point, this.map)) return;
    if (this.tool === "marker") this.openMarker(t("New place"), point);
    if (this.tool === "trail") {
      const moving = this.movingMark;
      this.mode("browse");
      if (moving) this.placeMark(point);
      else this.markTrail(point);
    }
    // Moving a place: a tap puts it there, as an alternative to dragging.
    const moving = this.movingPlace();
    if (moving) {
      moving.point = point;
      this.changed();
    }
    if (this.measuring()) {
      const tape = this.tape();
      this.measureHistory.push(copyPoints(tape));
      // A scale has two ends: once both are down, a tap moves the second.
      if (this.tool === "scale" && tape.length >= 2) tape[1] = point;
      else tape.push(point);
      this.measured();
    }
    if (this.tool === "route") {
      const route = this.route();
      if (route) {
        // A new point means the pending "Discard?" no longer applies.
        if (this.confirming === "cancel-route") this.confirming = undefined;
        this.routeHistory.push(copyPoints(route.points));
        route.points.push(point);
        this.changed();
      }
    }
  }
  private route() {
    return this.state.routes.find((r) => r.id === this.activeRoute);
  }
  measuring() {
    return this.tool === "measure" || this.tool === "scale";
  }
  /** The line the measure or scale tool is working on. */
  private tape() {
    return this.tool === "scale" ? this.scalePoints : this.measurePoints;
  }
  private setTape(points: Point[]) {
    if (this.tool === "scale") this.scalePoints = points;
    else this.measurePoints = points;
  }
  /** Measuring is never saved: only the line and the card change. */
  private measured() {
    this.viewer?.setMeasure?.(this.tape());
    this.tick++;
  }
  /** The Measure button opens and closes the tool; a map without a scale asks for one first. */
  toggleMeasure() {
    if (this.measuring()) return this.closeMeasure();
    if (this.tool !== "browse") return;
    this.closePlaceDetails();
    if (!this.state.metresPerPixel) return void this.show("scale-ask-dialog");
    this.measureHistory = [];
    this.mode("measure");
    track("measure_used");
    this.visit.measured = true;
  }
  private closeMeasure() {
    this.measurePoints = [];
    this.scalePoints = [];
    this.measureHistory = [];
    this.mode("browse");
  }
  /** Tap both ends of a known length, like the scale bar, then say how long it is. */
  startScale() {
    this.close("scale-ask-dialog");
    this.scalePoints = [];
    this.measureHistory = [];
    this.mode("scale");
  }
  /** × goes back to measuring if the map already has a scale to measure with. */
  private cancelScale() {
    if (!this.state.metresPerPixel) return this.closeMeasure();
    this.scalePoints = [];
    this.measureHistory = [];
    this.mode("measure");
  }
  private askScaleLength() {
    const pixels = pathLength(this.scalePoints), known = this.state.metresPerPixel;
    // Changing the scale starts from what the current one says.
    this.scaleMetresValue = known ? Math.round(pixels * known * 10) / 10 : null;
    this.show("scale-dialog");
    this.el("scale-metres")?.focus();
  }
  get scaleMetres() {
    const metres = Number(this.scaleMetresValue ?? 0);
    return metres > 0 && metres <= 100_000 ? metres : undefined;
  }
  saveScale() {
    const metres = this.scaleMetres, pixels = pathLength(this.scalePoints);
    if (!metres || !pixels) return;
    this.state.metresPerPixel = this.state.measuredScale = metres / pixels;
    this.close("scale-dialog");
    this.scalePoints = [];
    this.measureHistory = [];
    this.changed();
    this.mode("measure");
    this.showToast(t("Scale set"), "done");
  }
  private editRoute(route: PlannedRoute) {
    this.routeBefore = route.draft ? undefined : [...route.points];
    this.routeStart = { points: [...route.points], draft: route.draft };
    this.routeHistory = [];
    route.draft = true;
    this.activeRoute = route.id;
    this.changed();
    this.mode("route");
    // Like Move, editing opens on the work: the whole route, in frame.
    if (route.points.length) this.viewer?.fitPoints(route.points);
  }
  /** Start drawing immediately; the default name can be changed from Saved. */
  addRoute() {
    const route: PlannedRoute = {
      id: newId(),
      name: nextName(t("Route"), this.state.routes.map((r) => r.name)),
      points: [],
      created: Date.now(),
      draft: true,
    };
    this.state.routes.push(route);
    this.editRoute(route);
  }
  // A route is only kept with at least two points; Done always leaves it finished.
  private finishRoute() {
    const route = this.route(), before = this.routeBefore;
    this.activeRoute = undefined;
    this.routeBefore = undefined;
    this.routeStart = undefined;
    this.routeHistory = [];
    if (route) {
      if (route.points.length < 2 && before) {
        route.points = before;
        route.draft = false;
        this.showToast(t("{name} unchanged", { name: route.name }), "quiet");
      } else if (route.points.length >= 2) {
        track("route_saved", { points: route.points.length, edited: !!before });
        route.draft = false;
        this.showToast(t("{name} saved · {points}", { name: route.name, points: plural(route.points.length, "point") }), "done");
      } else {
        this.state.routes = this.state.routes.filter((r) => r.id !== route.id);
        if (route.points.length) this.showToast(t("Route discarded: it needs at least 2 points"), "removed");
      }
      this.changed();
    }
    this.mode("browse");
  }
  // × while drawing: drop this session's points. A new route goes away;
  // continued or edited ones return to how they were. Real work asks twice.
  private cancelRoute() {
    const route = this.route(), start = this.routeStart;
    if (!route || !start) return this.finishRoute();
    const changed = JSON.stringify(route.points) !== JSON.stringify(start.points);
    if (changed && route.points.length >= 2 && this.confirming !== "cancel-route") {
      this.confirming = "cancel-route";
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => (this.confirming = undefined), 3000);
      return;
    }
    clearTimeout(this.confirmTimer);
    this.confirming = undefined;
    this.activeRoute = undefined;
    this.routeBefore = undefined;
    this.routeStart = undefined;
    this.routeHistory = [];
    if (!start.points.length) this.state.routes = this.state.routes.filter((r) => r.id !== route.id);
    else {
      route.points = start.points;
      route.draft = start.draft;
    }
    if (changed)
      this.showToast(
        start.points.length ? t("{name} unchanged", { name: route.name }) : t("Route discarded"),
        start.points.length ? "quiet" : "removed",
      );
    this.changed();
    this.mode("browse");
  }
  private movingPlace() {
    return this.tool === "move" ? this.state.markers.find((m) => m.id === this.movingMarker) : undefined;
  }
  // Move: the pin lifts; drag it or tap where it goes, then Done (× puts it back).
  private moveMarker(marker: MapMarker) {
    this.movingMarker = marker.id;
    this.moveFrom = { ...marker.point };
    // Switching tools stops camera motion, so the glide starts after it.
    this.mode("move");
    this.viewer?.jumpTo(marker.point);
  }
  private finishMove(keep: boolean) {
    const marker = this.movingPlace(), from = this.moveFrom;
    this.movingMarker = undefined;
    this.moveFrom = undefined;
    if (marker && from) {
      const moved = marker.point.x !== from.x || marker.point.y !== from.y;
      if (!keep) marker.point = from;
      else if (moved) {
        recordEdit(marker, [{ field: "point" }]);
        track("place_moved", { kind: marker.kind });
      }
      if (moved) {
        this.showToast(
          keep ? t("{name} moved", { name: marker.label }) : t("{name} not moved", { name: marker.label }),
          keep ? "done" : "quiet",
        );
        this.changed();
      }
    }
    this.mode("browse");
  }
  /** The task card's X cancels: a route is dropped, a moved place goes back. */
  cancelTool() {
    if (this.tool === "route") this.cancelRoute();
    else if (this.tool === "measure") this.closeMeasure();
    else if (this.tool === "scale") this.cancelScale();
    else if (this.tool === "move") this.finishMove(false);
    else if (this.tool === "match" || this.tool === "check") this.cancelMatch();
    else this.mode("browse");
  }
  /** The task card's pencil: a route's name, or the scale Measure works with. */
  renameTool() {
    if (this.tool === "measure") return this.startScale();
    const route = this.route();
    if (route)
      this.name(t("Rename route"), route.name, (name) => {
        route.name = name;
        this.changed();
      });
  }
  toolDone() {
    if (this.tool === "move") this.finishMove(true);
    else if (this.tool === "scale") this.askScaleLength();
    else if (this.tool === "match") this.matchSpot();
    else if (this.tool === "check") this.finishMatch();
    else this.finishRoute();
  }
  /** Steps back through this session's taps and drags; once those run out, it keeps removing the last point. */
  undo() {
    if (this.measuring()) {
      const previous = this.measureHistory.pop();
      if (previous) this.setTape(previous);
      else if (!this.tape().pop()) return;
      return this.measured();
    }
    const route = this.route();
    const previous = this.routeHistory.pop();
    if (route && previous) route.points = previous;
    else if (route?.points.length) route.points.pop();
    else return;
    this.changed();
  }
  private editMarker(marker: MapMarker) {
    this.openMarker(t("Edit place"), marker.point, marker);
    // Under the card's shade every pin looks alike; this one says it's the one.
    this.viewer?.pulse?.(marker.id);
  }
  private editRouteDetails(route: PlannedRoute) {
    this.editingMarker = undefined;
    this.markerPoint = undefined;
    this.openForm(t("Edit route"), route, route);
    this.presentCard(true);
    this.viewer?.cover?.();
    this.spot = undefined;
    this.viewer?.pulse?.(route.id);
  }
  /** The card's Edit opens the form for what it shows. */
  editViewed() {
    const item = this.viewedItem();
    if (item && "label" in item) this.editMarker(item);
    else if (item) this.editRouteDetails(item);
  }
  routeIcon(route: PlannedRoute) {
    return icons.route.replace("<svg ", `<svg style="color:${routeColor(this.state, route.id)}" `);
  }
  /** The card wears its item's icon, and that icon's colour as its accent. */
  cardLook() {
    const route = this.state.routes.find((r) => r.id === (this.cardMode === "edit" ? this.editingRoute : this.viewingRoute));
    if (route) return { icon: this.routeIcon(route), color: routeColor(this.state, route.id) };
    const place = this.cardMode === "edit"
      ? { kind: this.formKind, water: this.formWater, danger: this.formDanger }
      : this.state.markers.find((m) => m.id === this.viewingMarker);
    if (!place) return { icon: icons.pin, color: "var(--neon-add)" };
    return { icon: placeIcon(place.kind, place), color: placeColor(place) };
  }
  /** The place or route whose details are open. */
  viewedItem() {
    return this.state.markers.find((m) => m.id === this.viewingMarker) ??
      this.state.routes.find((r) => r.id === this.viewingRoute);
  }
  /** Read a saved place or route first, keeping editing behind an explicit action. */
  private showDetails(item: MapMarker | PlannedRoute) {
    this.sheet(undefined);
    this.close("trip-dialog");
    this.close("mark-dialog");
    const place = "label" in item ? item : undefined;
    this.viewingMarker = place?.id;
    this.viewingRoute = place ? undefined : item.id;
    this.cardMode = "view";
    this.cardTitle = place ? place.label : (item as PlannedRoute).name;
    // The card reads the item as it is now, even when it changed without an edit here.
    this.tick++;
    this.presentCard(false);
    const details = this.el("marker-details"), photos = this.el("marker-detail-photos");
    if (details) details.scrollTop = 0;
    if (photos) photos.scrollLeft = 0;
    // The map stays full size behind the pane; the item centers above it.
    const card = this.dialog("marker-dialog");
    if (card) this.viewer?.cover?.(card.offsetTop);
    this.frame(item);
    this.viewer?.select?.(item.id);
    this.viewer?.pulse?.(item.id);
    this.viewer?.refreshLabels?.();
  }
  /** A route's length and walking time sit under its name, where a place says when it was updated,
   * followed by who drew it when it came from someone else. */
  cardSubtitle(item: MapMarker | PlannedRoute) {
    if ("label" in item) return updatedAgo(lastUpdated(item));
    return [travelSummary(item.points, this.state.metresPerPixel), item.by && t("Added by {name}", { name: item.by })]
      .filter(Boolean).join(" · ");
  }
  /** A place centers without zooming out; a route fits whole. */
  private frame(item: MapMarker | PlannedRoute) {
    if ("label" in item) this.viewer?.jumpTo(item.point, 1);
    else this.viewer?.fitPoints(item.points);
  }
  private presentCard(modal: boolean) {
    this.armDiscard();
    if (modal) this.formStart = this.formState();
    flushSync();
    const card = this.dialog("marker-dialog");
    if (!card) return;
    if (card.hasAttribute("open") && this.cardModal === modal) {
      this.el("marker-dialog-title")?.focus({ preventScroll: true });
      return;
    }
    // An open dialog can't change modality; reopen it without the close cleanup.
    if (card.hasAttribute("open")) {
      this.reopeningCard = true;
      card.close();
    }
    this.cardModal = modal;
    showDialog(card, modal);
  }
  /** Closes the place, route, trip or mark being read; true if there was one. */
  closePlaceDetails() {
    const wasTrip = this.isOpen("trip-dialog") || this.isOpen("mark-dialog");
    this.close("trip-dialog");
    this.close("mark-dialog");
    if (!this.isOpen("marker-dialog") || this.cardModal) return wasTrip;
    this.close("marker-dialog");
    return true;
  }
  private modalOpen() {
    return !!this.root.querySelector("dialog[open]:not([data-reading])");
  }
  /** X on the card: reading closes it; editing asks once before throwing typing away,
   * then goes back to the unchanged details or closes a form opened elsewhere. */
  cancelCard() {
    const editing = this.cardMode === "edit";
    if (editing && !this.confirmDiscard("marker-cancel", this.formState() !== this.formStart)) return;
    const item = this.viewedItem();
    if (editing && item) this.showDetails(item);
    else this.close("marker-dialog");
  }
  /** The card went: whatever it showed lets go of the map. */
  cardClosed() {
    if (this.controller.signal.aborted) return;
    if (this.reopeningCard) {
      this.reopeningCard = false;
      return;
    }
    this.close("photo-viewer");
    this.viewingMarker = this.viewingRoute = undefined;
    this.viewer?.select?.();
    this.formVersion++;
    this.releasePhotos();
    if (!this.viewingTrip) this.viewer?.cover?.();
    this.viewer?.previewPlace?.();
    this.viewer?.refreshLabels?.();
  }
  pickKind(kind: Kind) {
    this.formKind = kind;
    this.close("kind-dialog");
    if (!this.editingMarker && this.markerPoint) this.viewer?.previewPlace?.({ point: this.markerPoint, kind });
  }
  /** Tapping the chosen water level again clears it. */
  pickWater(level: WaterLevel) {
    this.formWater = level === this.formWater ? undefined : level;
  }
  pickDanger(level: DangerLevel) {
    this.formDanger = level;
  }
  private deleteRoute(route: PlannedRoute) {
    const index = this.state.routes.indexOf(route);
    this.state.routes = this.state.routes.filter((r) => r.id !== route.id);
    if (this.activeRoute === route.id) {
      this.activeRoute = undefined;
      this.mode("browse");
    }
    this.changed();
    this.deleted(route.name, () => this.state.routes.splice(index, 0, route));
  }
  /** Two taps here too, as in the Saved menu: the first arms Delete briefly. */
  deleteFromCard() {
    if (this.cardDeleteArmed !== "marker-delete") return this.armCardDelete("marker-delete");
    this.armCardDelete();
    const route = this.state.routes.find((r) => r.id === this.editingRoute);
    if (route) {
      this.close("marker-dialog");
      this.deleteRoute(route);
      this.mode("browse");
      return;
    }
    const index = this.state.markers.findIndex((m) => m.id === this.editingMarker);
    const deleted = this.state.markers[index];
    this.state.markers = this.state.markers.filter((m) => m.id !== this.editingMarker);
    this.close("marker-dialog");
    this.changed();
    this.mode("browse");
    if (deleted) {
      track("place_deleted", { kind: deleted.kind });
      this.deleted(deleted.label, () => this.state.markers.splice(index, 0, deleted));
    }
  }
  private saveRoute(route: PlannedRoute) {
    const name = this.formLabel.trim();
    if (!name) return;
    const description = this.formDescription.trim();
    const unchanged = route.name === name && (route.description ?? "") === description &&
      (route.photos ?? []).join() === this.formPhotos.join();
    route.name = name;
    if (description) route.description = description;
    else delete route.description;
    if (this.formPhotos.length) route.photos = [...this.formPhotos];
    else delete route.photos;
    const returnToDetails = this.viewingRoute === route.id && !this.moveAfterSave;
    if (!returnToDetails) this.close("marker-dialog");
    if (!unchanged) this.changed();
    if (this.moveAfterSave) return this.editRoute(route);
    if (returnToDetails) this.showDetails(route);
    this.showToast(unchanged ? t("{name} unchanged", { name }) : t("{name} updated", { name }), unchanged ? "quiet" : "done");
  }
  /** Save on the card: a new or edited place, or a route's details. */
  saveCard() {
    if (this.cardMode !== "edit" || this.photoJobs) return;
    const route = this.state.routes.find((r) => r.id === this.editingRoute);
    if (route) return this.saveRoute(route);
    if (!this.markerPoint) return;
    const label = this.markerLabel();
    if (!label) return;
    const existing = this.state.markers.find((m) => m.id === this.editingMarker);
    const created = existing?.created ?? Date.now();
    const kind = this.formKind;
    const marker: MapMarker = {
      id: existing?.id ?? newId(),
      point: this.markerPoint,
      label,
      description: this.formDescription.trim(),
      ...(this.formPhotos.length ? { photos: [...this.formPhotos] } : {}),
      kind,
      ...(kind === "flooded" && this.formWater ? { water: this.formWater } : {}),
      ...(kind === "unstable" ? { danger: this.formDanger } : {}),
      created,
      ...(this.formLog.length ? { log: [...this.formLog] } : {}),
    };
    const kept = new Set(this.formLog.map((entry) => entry.id));
    const removed = (existing?.log ?? []).filter((entry) => !kept.has(entry.id)).map((entry) => entry.id);
    if (existing?.deletedLog || removed.length) marker.deletedLog = [...existing?.deletedLog ?? [], ...removed];
    // Removing history entries is tidying, not an edit to record.
    const changes = existing ? placeChanges(existing, marker) : [];
    const unchanged = !!existing && !changes.length && !removed.length;
    recordEdit(marker, changes);
    // An edit keeps the place where it was in the Saved list.
    if (!existing) {
      this.state.markers.push(marker);
      track("place_added", { kind: marker.kind, photos: this.formPhotos.length });
      this.visit.place_added = true;
      this.newMarkerKind = marker.kind;
    } else if (!unchanged) {
      this.state.markers = this.state.markers.map((m) => m === existing ? marker : m);
      track("place_edited", { kind: marker.kind, fields: changes.map((change) => change.field).join(",") });
    }
    const returnToDetails = this.viewingMarker === marker.id && !this.moveAfterSave;
    if (!returnToDetails) this.close("marker-dialog");
    if (!unchanged) this.changed();
    if (this.moveAfterSave) return this.moveMarker(marker);
    if (returnToDetails) this.showDetails(marker);
    else this.mode("browse");
    this.showToast(!existing ? t("{name} saved", { name: label }) : unchanged ? t("{name} unchanged", { name: label }) : t("{name} updated", { name: label }),
      unchanged ? "quiet" : "done");
  }
  /** Move or Edit points from the card keeps what was typed, then lifts the pin or the route's points. */
  saveThenMove() {
    this.moveAfterSave = true;
    this.saveCard();
    this.moveAfterSave = false;
  }
  private bind() {
    this.on(document, "visibilitychange", () => {
      if (document.hidden) {
        this.endVisit();
        void this.flush();
      } else this.visit = ViewerControls.newVisit();
    });
    this.on(document, "pointerdown", (event) => {
      const target = event.target as Element | null;
      // Exploring the map dismisses the keyboard but preserves the query and matches.
      if (target?.id === "map-canvas" && this.openSheet === "search") this.el("map-search")?.blur();
      // Reading a place, a press anywhere off the card and the map closes it; the
      // map closes it on a tap, so it can still pan and zoom.
      if (!target?.closest?.("dialog") && target?.id !== "map-canvas") this.closePlaceDetails();
      // Tapping anywhere outside an open row menu closes it.
      if (this.rowMenu && !target?.closest?.("[data-menu], [data-sheet]")) this.closeRowMenu();
    });
    this.on(window, "resize", () => this.closeRowMenu());
    if (window.visualViewport) this.on(window.visualViewport, "resize", () => this.closeRowMenu());
    this.on(window, "pagehide", () => {
      void this.flush();
    });
  }
  /** Once the panel has risen into place, menus and labels go where it ended up. */
  sheetSettled(event: TransitionEvent) {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    this.settled++;
    this.viewer?.refreshLabels?.();
  }
  setDark(on: boolean) {
    this.state.inverted = on;
    this.changed(true);
  }
  setLayer(layer: keyof NavigationState["layers"], on: boolean) {
    this.state.layers[layer] = on;
    this.changed(true);
  }
  setBrightness(level: number) {
    this.state.dimming = level;
    this.changed(true);
  }
  darkStatus() {
    return this.state.inverted ? darkMessages[this.darkKind] : t("Off: original colors");
  }
  straighten() {
    this.viewer?.straighten?.();
  }
  setRotationMode(mode: RotationMode) {
    this.state.rotationMode = mode;
    track("rotation_changed", { mode });
    this.changed();
    if (mode === "compass") void this.startCompass(true);
    else this.stopCompass();
  }
  /** Tap and Auto pick Compass mode and how it follows. Following reads the
   * choice each time, so a change applies at once. */
  pickFollow(follow: "tap" | "auto") {
    setPreference("compass-follow", follow);
    if (this.state.rotationMode === "compass") this.tick++;
    else this.setRotationMode("compass");
  }
  /** Tapping a compass tile again retries a compass that needs permission or went missing. */
  retryCompass() {
    if (this.state.rotationMode === "compass" && (this.compass === "missing" || this.compass === "blocked"))
      void this.startCompass(true);
  }
  pickSpeed(speed: CompassSpeed) {
    setPreference("compass-speed", speed);
    this.tick++;
  }
  /** Scrolling the wheel turns the map as each degree passes the middle. */
  northScrolled(scrollTop: number) {
    const degrees = Math.round(scrollTop / NORTH_ROW_PX) + NORTH_MIN;
    if (degrees !== this.state.northOffset) this.setNorth(degrees);
  }
  private setNorth(degrees: number) {
    this.state.northOffset = wrapNorth(degrees);
    this.persistence.changed();
    this.orient();
    this.tick++;
  }
  /** Only a wheel showing another degree moves; a scrolling one already matches. */
  private syncNorthWheel() {
    const wheel = this.el("north-offset"), row = this.state.northOffset - NORTH_MIN;
    if (wheel && Math.round(wheel.scrollTop / NORTH_ROW_PX) !== row) wheel.scrollTop = row * NORTH_ROW_PX;
  }
  /** What the line under the rotation list says about the compass. */
  compassHelp() {
    const help: Partial<Record<CompassStatus, string>> = {
      waiting: t("Looking for the compass…"),
      missing: compassNeedsPermission()
        ? t("Tap your compass choice again to turn it on.")
        : t("No compass found. Compass mode needs a phone or tablet."),
      blocked: t("Compass access is off. Allow motion and orientation access for this site, then tap your choice again."),
    };
    return (this.state.rotationMode === "compass" && help[this.compass]) || "";
  }
  /** Asks for the compass when `ask` (from a tap), then follows it. */
  private async startCompass(ask: boolean) {
    this.stopCompass();
    const run = this.compassRun;
    this.compass = "waiting";
    const allowed = !ask || (await allowCompass());
    if (run !== this.compassRun) return;
    if (!allowed) {
      this.compass = "blocked";
      return;
    }
    // Tap only turns the map on a double tap. Otherwise the first heading
    // turns it at once; later, a heading a step or more away starts a hold,
    // and the map turns to the hold's average once readings have stayed
    // within the window of it for the delay. Walking sways the phone a few
    // degrees each step, which the window allows and the average evens out;
    // a real turn restarts the hold, and a heading that returns averages
    // back to where the map is. Live skips the wait. Smaller changes are
    // left alone: following each one redraws the map nonstop.
    const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    let hold: { x: number; y: number } | undefined, settle: ReturnType<typeof setTimeout> | undefined;
    const held = () => (((Math.atan2(hold!.y, hold!.x) * 180) / Math.PI) + 360) % 360;
    const drop = () => {
      clearTimeout(settle);
      hold = undefined;
    };
    const stop = watchCompass((heading) => {
      this.reading = heading;
      const delay = followDelay(), shown = this.heading;
      if (hold && (!delay || gap(heading, held()) >= COMPASS_HOLD)) drop();
      if (delay !== undefined && (shown === undefined || (delay === 0 && gap(heading, shown) >= COMPASS_STEP))) {
        this.heading = heading;
        this.orient();
      } else if (delay && (hold || gap(heading, shown!) >= COMPASS_STEP)) {
        if (!hold) {
          hold = { x: 0, y: 0 };
          settle = setTimeout(() => {
            const average = held();
            hold = undefined;
            if (gap(average, this.heading!) < COMPASS_STEP) return;
            this.heading = average;
            this.orient();
          }, delay);
        }
        const radians = (heading * Math.PI) / 180;
        hold.x += Math.cos(radians);
        hold.y += Math.sin(radians);
      }
      if (this.compass !== "on") this.compass = "on";
    });
    const timer = setTimeout(() => {
      if (this.compass === "waiting") this.compass = "missing";
    }, COMPASS_WAIT_MS);
    this.stopWatching = () => {
      stop();
      clearTimeout(timer);
      drop();
    };
  }
  private stopCompass() {
    this.compassRun++;
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.compass = "off";
    this.heading = this.reading = undefined;
    this.viewer?.orient?.(undefined);
  }
  /** In Tap, a double tap on the map turns it to the phone; otherwise it does nothing. */
  private orientOnTap() {
    if (this.state.rotationMode !== "compass" || preference("compass-follow") !== "tap") return;
    if (this.reading === undefined) return;
    this.heading = this.reading;
    this.orient();
  }
  /** The map's north points where the phone says north is. */
  private orient() {
    if (this.heading !== undefined)
      this.viewer?.orient?.((-(this.heading + this.state.northOffset) * Math.PI) / 180);
  }
  /** The task card for the tool in use: its icon, title and hint, and for Measure the total. */
  toolView() {
    const route = this.route();
    const count = route?.points.length ?? 0;
    const discarding = this.confirming === "cancel-route";
    const scale = this.state.metresPerPixel;
    const measuring = this.measuring();
    const tape = measuring ? this.tape() : [];
    const metres = this.tool === "measure" && scale && tape.length > 1 ? pathLength(tape) * scale : undefined;
    const routeMetres = scale && count > 1 ? pathLength(route!.points) * scale : undefined;
    const spotMatched = this.tool === "match" && !!this.spots.length;
    const texts: Record<Tool, [string, string, string]> = {
      browse: ["", "", ""],
      move: [icons.move, this.movingPlace()?.label ?? t("Place"), t("Drag the pin, or tap where it goes")],
      marker: [icons.pin, t("New place"), t("Tap the map where it goes")],
      trail: this.movingMark
        ? [icons.move, t("Move mark"), t("Tap the map where you were")]
        : [icons.here, t("Mark where you are"), t("Tap the map where you are")],
      route: [
        icons.route,
        route?.name ?? t("Route"),
        discarding
          ? this.routeStart?.points.length
            ? t("Tap × again to undo your changes")
            : t("Tap × again to discard this route")
          // Done waits for a second point, so the hint asks for it.
          : routeMetres !== undefined ? t("{distance} · Tap to add, drag to adjust", { distance: formatDistance(routeMetres) })
          : count > 1 ? t("{points} · Tap to add, drag to adjust", { points: plural(count, "point") })
          : count ? t("1 point · Tap where it goes next") : t("Tap where the route starts"),
      ],
      measure: [
        icons.measure,
        t("Measure"),
        metres !== undefined ? t("Tap to add, drag to adjust")
          : tape.length ? t("Tap the next point") : t("Tap where to start measuring"),
      ],
      scale: [
        icons.scale,
        t("Set scale"),
        tape.length > 1 ? t("Drag the ends to adjust, then tap Next")
          : tape.length ? t("Tap the other end") : t("Tap one end of the scale bar or of a known length"),
      ],
      match: [icons.map, this.spots.length ? t("Spot 1 matched") : t("Match a spot"), this.matchMessage ||
        (this.spots.length ? t("Match a second spot to set the scale and rotation automatically, or use the rulers.")
          : t("Find a town or street, then put both crosses on the same corner"))],
      check: [icons.map, t("Calibrate"), t("Drag a ruler to resize or turn your map")],
    };
    const [icon, title, message] = texts[this.tool];
    return {
      icon, title, message, discarding,
      // Measuring, the big line is the total at one end and the walk at the other.
      distance: metres !== undefined ? formatDistance(metres) : undefined,
      walk: metres !== undefined ? t("~{time} on foot", { time: formatWalk(metres) }) : undefined,
      rename: this.tool === "route" ? t("Rename route") : this.tool === "measure" ? t("Change scale") : undefined,
      actions: this.tool !== "browse" && this.tool !== "marker" && this.tool !== "trail",
      undo: this.tool === "route" || measuring,
      canUndo: measuring ? !!tape.length || !!this.measureHistory.length : !!count || !!this.routeHistory.length,
      undoSpot: spotMatched,
      useSliders: spotMatched,
      matchSpots: this.tool === "check",
      rulers: this.tool === "check" ? this.rulerValues() : undefined,
      search: this.tool === "match" && !this.spots.length,
      // Measuring has nothing to save, so × is how it ends; the scale goes on to its length.
      done: this.tool !== "measure",
      doneIcon: this.tool === "scale" ? icons.next : this.tool === "match" ? icons.pair : icons.check,
      doneLabel: this.tool === "scale" ? t("Next")
        : this.tool === "match" ? t("Match spot {number}", { number: this.spots.length + 1 }) : t("Done"),
      canFinish: !((this.tool === "route" || this.tool === "scale") && (this.tool === "route" ? count : tape.length) < 2),
    };
  }
  streetsView() {
    const placed = !!this.state.geo;
    return { placed, on: placed && !!this.state.streets, status: placed ? t("Lined up with OpenStreetMap") : t("Line up the map first") };
  }
  setStreets(on: boolean) {
    this.state.streets = on;
    this.changed(true);
  }
  // The link to a position app on this phone, such as sPDR.
  readonly canLink = canLink(navigator);
  private linkTick = $state(0);
  private link = new PositionLink(() => {
    this.linkTick++;
    this.showLivePosition();
    this.recordLivePosition();
  });
  /** The user ended a trip with the app still running: no new one starts until it stops or they mark. */
  private liveTripEnded = false;
  /** While the app runs, its positions grow the trip like marks, with nothing to acknowledge. */
  private recordLivePosition() {
    const { status, state } = this.link, at = state?.position, geo = this.state.geo, trail = this.state.trail;
    if (status === "connected" && !state?.running) this.liveTripEnded = false;
    if (trail.length) this.liveTripEnded = false;
    if (status !== "connected" || !state?.running || !at || at.relocalising || !geo || this.liveTripEnded) return;
    // Being lined up, the map isn't where it will be; a mark being read or moved must stay the last.
    if (this.tool === "match" || this.tool === "check" || this.movingMark || this.isOpen("mark-dialog")) return;
    const point = worldToScreen(invert(geo), toMercator(at)), last = trail.at(-1);
    if (!insideImage(point, this.map)) return;
    if (last && Math.hypot(point.x - last.x, point.y - last.y) * geoMetresPerPixel(geo, this.map) < LIVE_SPACING_METRES) return;
    const view = this.markedView();
    this.state.trail.push({ ...point, time: Date.now(), live: true, ...(view && { view }) });
    if (trail.length === 1) track("trip_started");
    this.changed();
  }
  private showLivePosition() {
    const at = this.link.state?.position, geo = this.state.geo;
    this.viewer?.setLive?.(at && geo ? {
      point: worldToScreen(invert(geo), toMercator(at)),
      radius: at.accuracy / geoMetresPerPixel(geo, this.map),
      stale: this.link.status !== "connected" || !this.link.state?.running,
      ...(at.heading !== undefined ? { ahead: worldToScreen(invert(geo), aheadOf(at, at.heading)) } : {}),
    } : undefined);
  }
  /** The link's state in words, or nothing while it is off. */
  linkView() {
    void this.linkTick;
    void this.tick;
    const { status, state } = this.link;
    if (status === "off") return undefined;
    const connected = status === "connected", at = state?.position;
    const title = !state ? t("Waiting for sPDR")
      : !connected ? t("{app} · connection lost", { app: state.app })
      : state.running ? t("{app} · running", { app: state.app }) : t("{app} · stopped", { app: state.app });
    const position = at && [
      t("±{metres} m", { metres: Math.round(at.accuracy) }),
      ...(at.confidence !== undefined ? [t("confidence {percent}%", { percent: Math.round(at.confidence * 100) })] : []),
      plural(state!.steps, "step"),
    ].join(" · ");
    const hint = !state ? t("Open sPDR on this phone. The link connects by itself.")
      : !connected ? t("Showing the last position it gave.")
      : at?.relocalising ? t("{app} is searching for your position.", { app: state.app })
      : position && !this.state.geo ? t("Calibrate this map to see the position on it.")
      : position ?? (state.hasGraph ? t("Set your position in {app} to start.", { app: state.app })
        : t("{app} has no galleries loaded.", { app: state.app }));
    const shown = (this.state.vectors ?? []).filter((layer) => layer.visible).reduce((total, layer) => total + layer.lines.length, 0);
    return { connected, title, hint, running: connected && !!state?.running, sending: this.sendingLines,
      send: connected && shown ? t("Send {lines} to sPDR", { lines: plural(shown, "line") }) : undefined };
  }
  private sendingLines = $state(false);
  /** Gives sPDR the lines shown on this map to follow, in place of those sent before. */
  async sendLines() {
    if (this.sendingLines) return;
    this.sendingLines = true;
    const layers = this.state.vectors ?? [];
    const count = layers.filter((layer) => layer.visible).reduce((total, layer) => total + layer.lines.length, 0);
    try {
      const metres = await this.link.sendLines(shownLinesGeoJson(layers));
      this.showToast(metres === undefined ? t("{lines} sent to sPDR", { lines: plural(count, "line") })
        : t("{lines} sent to sPDR · {distance}", { lines: plural(count, "line"), distance: formatDistance(metres) }), "done");
    } catch (error) {
      this.showToast(error instanceof LinkRefused && error.message === "bad-graph"
        ? t("sPDR couldn’t build galleries from these lines.") : t("sPDR didn’t answer."), "error");
    } finally {
      this.sendingLines = false;
    }
  }
  toggleLink() {
    const on = this.link.status === "off";
    if (on) this.link.connect();
    else this.link.disconnect();
    void saveSetting("position-link", on).catch(() => {});
  }
  openLinkedApp() {
    location.href = OPEN_SPDR_URL;
  }
  /** Android lets only a visible app start tracking, so that can mean going there. */
  async startLinked() {
    try {
      await this.link.start();
    } catch (error) {
      if (error instanceof LinkRefused && error.message === "open-app") {
        this.showToast(t("Press Start in sPDR."), "quiet");
        this.openLinkedApp();
      } else this.showToast(t("sPDR didn’t answer."), "error");
    }
  }
  async stopLinked() {
    await this.link.stop().catch(() => this.showToast(t("sPDR didn’t answer."), "error"));
  }
  /** A mark is the user saying where they are, which corrects the other app too, loosely. */
  private sendMark(point: Point) {
    const geo = this.state.geo;
    if (this.link.status !== "connected" || !geo) return;
    const { lat, lon } = toLonLat(worldToScreen(geo, point));
    void this.link.sendPosition(lat, lon, MARK_ACCURACY_METRES).catch((error: unknown) => {
      const code = error instanceof LinkRefused ? error.message : "";
      this.showToast(code === "not-near" ? t("sPDR didn’t use this mark: no gallery within 100 m.")
        : code === "no-graph" ? t("sPDR didn’t use this mark: it has no galleries loaded.")
        : t("sPDR didn’t answer."), "error");
    });
  }
  vectorRows() {
    return (this.state.vectors ?? []).map(({ id, name, visible, lines }) => ({ id, name, visible, count: plural(lines.length, "line") }));
  }
  async importVectors(file: File) {
    let layer: VectorLayer;
    try {
      if (file.size > MAX_VECTOR_BYTES) throw new Error(t("This file is too large: {megabytes} MB at most.", { megabytes: MAX_VECTOR_BYTES / 2 ** 20 }));
      layer = readVectorFile(new Uint8Array(await file.arrayBuffer()), file.name, newId());
    } catch (error) {
      this.showToast(errorMessage(error), "error");
      return;
    }
    this.state.vectors = [...this.state.vectors ?? [], layer];
    this.changed();
    this.showToast(this.vectorsOnMap(layer) ? t("{name} added · {lines}", { name: layer.name, lines: plural(layer.lines.length, "line") })
      : t("{name} added, but its lines fall outside this map.", { name: layer.name }), this.vectorsOnMap(layer) ? "done" : "error");
  }
  private vectorsOnMap({ lines }: VectorLayer) {
    const geo = this.state.geo;
    if (!geo) return false;
    const toImage = invert(geo);
    return lines.some((line) => {
      for (let i = 0; i < line.length; i += 2)
        if (insideImage(worldToScreen(toImage, { x: line[i]!, y: line[i + 1]! }), this.map)) return true;
      return false;
    });
  }
  setVectorVisible(id: string, visible: boolean) {
    this.state.vectors = this.state.vectors?.map((layer) => layer.id === id ? Object.assign(layer, { visible }) : layer);
    this.changed();
  }
  deleteVector(id: string) {
    const before = this.state.vectors ?? [];
    this.state.vectors = before.filter((layer) => layer.id !== id);
    this.changed();
    this.showToast(t("Lines removed"), "removed", () => {
      this.state.vectors = before;
      this.changed();
    });
  }
  /** What the rulers are at, in words. */
  private rulerValues() {
    const geo = this.state.geo;
    if (!geo) return { scale: "", rotation: "", measured: false };
    return {
      measured: !!this.scaleToKeep(),
      scale: t("1 px = {metres} m", { metres: geoMetresPerPixel(geo, this.map).toLocaleString(locale, { maximumSignificantDigits: 4 }) }),
      rotation: `${geoNorth(geo).toLocaleString(locale, { maximumFractionDigits: 1 })}°`,
    };
  }
  /** The map's point under the middle of its half, where the cross is. */
  private viewCenter() {
    return this.state.view?.center ?? { x: this.map.width / 2, y: this.map.height / 2 };
  }
  /** A map lined up before goes straight to its rulers; a new one starts by matching a spot. */
  calibrate() {
    if (this.tool !== "browse") return;
    this.closePlaceDetails();
    const geo = this.state.geo;
    this.geoBefore = geo;
    this.spots = [];
    this.adjusted = false;
    this.matchMessage = "";
    this.placeQuery = "";
    if (!geo) {
      this.mode("match");
      return this.findStreets();
    }
    const map = { ...this.viewCenter() };
    this.pivot = { map, place: worldToScreen(geo, map) };
    this.mode("check");
    this.viewer?.markSpot?.(this.pivot);
  }
  /** The streets start where the map is, or where the last map went. */
  private findStreets() {
    const geo = this.state.geo;
    if (geo) return this.viewer?.moveStreets?.(worldToScreen(geo, this.viewCenter()));
    void loadSetting("streets-place").then((place) => {
      if (place && this.tool === "match") this.viewer?.moveStreets?.(toMercator(place));
    }, () => {});
  }
  /** Where one spot puts the map: as it lay, by its known scale and north, or
   * failing those, as big and as turned as it shows beside the streets now. */
  private oneSpotGeo(spot: Spot) {
    const before = this.geoBefore, scale = this.state.metresPerPixel, view = this.state.view;
    if (before) return pinGeo(spot, before.scale, before.rotation ?? 0);
    if (scale) return placeGeo(spot, scale, this.state.northOffset);
    return pinGeo(spot, (view?.scale ?? 1) / (this.viewer?.streetsScale?.() ?? 1), view?.rotation ?? 0);
  }
  /** Takes what's under the two crosses as a spot. The second places the map;
   * after the first it's up to you: a second spot, or the rulers. */
  private matchSpot() {
    const place = this.viewer?.streetsCenter?.();
    if (!place) return;
    const spot = { map: { ...this.viewCenter() }, place }, [first] = this.spots;
    this.matchMessage = first && spotsTooClose(first, spot, this.map) ? t("Pick a spot further from spot 1") : "";
    if (this.matchMessage) return;
    if (!first) {
      this.spots = [spot];
      return this.viewer?.markSpot?.(spot);
    }
    this.spots = [first, spot];
    this.showCalibrated(spotsGeo(first, spot));
  }
  /** One spot, and the rulers set the rest. */
  useSliders() {
    const [spot] = this.spots;
    if (spot) this.showCalibrated(this.oneSpotGeo(spot));
  }
  private showCalibrated(geo: Geo) {
    this.pivot = this.spots[0];
    this.state.geo = geo;
    this.matchMessage = "";
    this.mode("check");
    this.changed(true);
  }
  /** Back from the rulers to the spots, keeping the first; ruler changes are dropped. */
  matchSpots() {
    this.spots = this.spots.slice(0, 1);
    this.state.geo = this.geoBefore;
    this.adjusted = false;
    this.mode("match");
    if (!this.spots.length) {
      this.viewer?.markSpot?.();
      this.findStreets();
    }
    this.changed(true);
  }
  /** Takes the first spot back. */
  undoSpot() {
    this.spots = [];
    this.matchMessage = "";
    this.viewer?.markSpot?.();
  }
  /** Moves a ruler by `steps`, about the pivot: more steps, a bigger map or more degrees. */
  adjustGeo(ruler: "scale" | "rotation", steps: number) {
    const geo = this.state.geo, pivot = this.pivot;
    if (!geo || !pivot) return;
    const rotation = geo.rotation ?? 0;
    this.adjusted = true;
    this.state.geo = ruler === "scale"
      ? pinGeo(pivot, geo.scale * Math.exp(steps * SCALE_STEP), rotation)
      : pinGeo(pivot, geo.scale, rotation - steps * TURN_STEP);
    this.changed(true);
  }
  /** Back to the scale set with the Measure tool, about the pivot. */
  resetScale() {
    const geo = this.state.geo, pivot = this.pivot, measured = this.scaleToKeep();
    if (!geo || !pivot || !measured) return;
    this.adjusted = true;
    this.state.geo = pinGeo(pivot, (geo.scale * measured) / geoMetresPerPixel(geo, this.map), geo.rotation ?? 0);
    this.changed(true);
  }
  /** The measured scale, even before the first calibration has set it aside. */
  private scaleToKeep() {
    return this.state.measuredScale ?? (this.geoBefore ? undefined : this.state.metresPerPixel);
  }
  /** Done keeps the streets on, and the scale and north, unless only the position changed. */
  private finishMatch() {
    const geo = this.state.geo!,
      measured = this.spots.length > 1 || this.adjusted || !this.state.metresPerPixel;
    this.state.streets = true;
    if (measured) {
      // A scale from before the first calibration was measured by hand.
      if (!this.geoBefore) this.state.measuredScale ??= this.state.metresPerPixel;
      this.state.metresPerPixel = geoMetresPerPixel(geo, this.map);
      this.setNorth(geoNorth(geo));
    }
    void saveSetting("streets-place", toLonLat(worldToScreen(geo, { x: this.map.width / 2, y: this.map.height / 2 }))).catch(() => {});
    this.leaveMatch();
    this.showToast(measured ? t("Lined up: scale and north now come from the streets") : t("Lined up with the streets"), "done");
  }
  /** × leaves the map as it was. */
  private cancelMatch() {
    this.state.geo = this.geoBefore;
    this.leaveMatch();
  }
  private leaveMatch() {
    this.geoBefore = this.pivot = undefined;
    this.spots = [];
    this.mode("browse");
    // The map was turned to read it against the streets; a locked one goes back.
    if (this.state.rotationMode === "locked") this.viewer?.straighten?.();
    this.changed(true);
  }
  /** Moves the streets to the place searched for. */
  async findPlace() {
    const query = this.placeQuery.trim();
    if (!query || this.matchMessage === t("Searching…")) return;
    (document.activeElement as HTMLElement | null)?.blur();
    this.matchMessage = t("Searching…");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=${locale}&q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(String(response.status));
      const [found] = (await response.json()) as { lat: string; lon: string }[];
      this.matchMessage = found ? "" : t("Nothing found. Try a town nearby.");
      if (found && this.tool === "match")
        this.viewer?.moveStreets?.(toMercator({ lon: Number(found.lon), lat: Number(found.lat) }));
    } catch {
      this.matchMessage = t("Could not search. Check the connection.");
    }
  }
  /** Saved rows open a place's or route's details; ⋯ opens its actions. */
  openRow(item: RowItem) {
    this.closeRowMenu();
    this.rowMenu = item.key;
    this.rowSheet = { key: item.key, title: item.label, detail: item.meta, icon: item.icon, actions: item.actions };
  }
  /** Arriving, the item pulses so the eye finds it at once. */
  jumpRow(item: RowItem) {
    item.jump();
    this.viewer?.pulse?.(item.key);
    this.sheet(undefined);
  }
  /** The ⋯ sheet went, by its X, its backdrop or an action. */
  rowSheetClosed(key: string) {
    if (this.rowMenu === key) this.closeRowMenu();
  }
  /** Places and routes as Saved lists them, ordered and filtered. */
  savedRows() {
    const places = orderPlaces(this.placeKinds.size
      ? this.state.markers.filter((marker) => this.placeKinds.has(marker.kind)) : this.state.markers, this.placeOrder);
    return {
      places: places.map((marker): RowItem => ({
        key: marker.id,
        label: marker.label,
        description: marker.description,
        photos: marker.photos,
        icon: placeIcon(marker.kind, marker),
        jump: () => this.open(marker, "saved"),
        actions: [
          { label: t("Edit"), icon: icons.edit, action: () => this.editMarker(marker) },
          { label: t("Move"), icon: icons.move, action: () => this.moveMarker(marker) },
          ...(this.onShare ? [{ label: t("Share"), icon: icons.share, action: () => this.onShare?.({ kind: "marker", id: marker.id }) }] : []),
          this.deleteAction(marker.id, () => {
            const index = this.state.markers.indexOf(marker);
            this.state.markers = this.state.markers.filter((m) => m.id !== marker.id);
            this.changed();
            track("place_deleted", { kind: marker.kind });
            this.deleted(marker.label, () => this.state.markers.splice(index, 0, marker));
          }),
        ],
      })),
      routes: orderRoutes(this.state.routes, this.routeOrder).map((route): RowItem => ({
        key: route.id,
        label: route.name,
        description: route.description,
        meta: `${travelSummary(route.points, this.state.metresPerPixel) ?? plural(route.points.length, "point")}${route.draft ? ` · ${t("unfinished")}` : ""}`,
        photos: route.photos,
        icon: this.routeIcon(route),
        jump: () => this.open(route, "saved"),
        actions: [
          { label: t("Edit"), icon: icons.edit, action: () => this.editRouteDetails(route) },
          { label: route.draft ? t("Continue") : t("Edit points"), icon: icons.route, action: () => this.editRoute(route) },
          ...(this.onShare && !route.draft ? [{ label: t("Share"), icon: icons.share, action: () => this.onShare?.({ kind: "route", id: route.id }) }] : []),
          this.deleteAction(route.id, () => this.deleteRoute(route)),
        ],
      })),
    };
  }
  /** Past trips, newest first: the trip just ended is the one most likely looked for. */
  tripRows() {
    const scale = this.state.metresPerPixel;
    return [...this.state.trips].reverse().map((trip): RowItem => ({
      key: trip.id,
      label: this.tripName(trip),
      // A name no longer says which day it was.
      meta: [trip.name ? logDate(trip.points[0]!.time) : clock(trip.points[0]!.time),
        scale ? formatDistance(pathLength(trip.points) * scale) : plural(trip.points.length, "point"),
        formatMinutes(Math.round((trip.ended - trip.points[0]!.time) / 60_000))].join(" · "),
      icon: icons.trail,
      jump: () => this.showTrip(trip),
      actions: [this.deleteAction(trip.id, () => {
        const index = this.state.trips.indexOf(trip);
        this.state.trips = this.state.trips.filter((other) => other.id !== trip.id);
        if (this.viewingTrip === trip.id) this.close("trip-dialog");
        this.changed();
        this.deleted(this.tripName(trip), () => this.state.trips.splice(index, 0, trip));
      })],
    }));
  }
  /** During a trip: how far it has come and when it was last marked. */
  tripSummary() {
    const trail = this.state.trail, last = trail.at(-1);
    if (!last) return undefined;
    const scale = this.state.metresPerPixel;
    return {
      distance: scale ? formatDistance(pathLength(trail) * scale) : "–",
      time: this.tripClock(),
      last: timeAgo(last.time, Date.now()),
      count: String(trail.length),
    };
  }
  /** The panel's subtitle during a trip. */
  tripStarted() {
    const start = this.state.trail[0];
    if (!start) return undefined;
    return t("Started {time}", { time: dayValue(start.time) === dayValue(Date.now()) ? clock(start.time) : logDate(start.time) });
  }
  /** The time since the trip started, on Trail, ticking each minute. */
  tripClock() {
    const start = this.state.trail[0];
    return start && formatMinutes(Math.floor(Math.max(0, this.clockNow - start.time) / 60_000));
  }
  private renderTripClock() {
    clearTimeout(this.tripClockTimer);
    const start = this.state.trail[0];
    this.clockNow = Date.now();
    if (!start) return;
    const elapsed = Math.max(0, this.clockNow - start.time);
    this.tripClockTimer = setTimeout(() => this.renderTripClock(), 60_000 - (elapsed % 60_000));
  }
  /** A section's menu: an order, picked once, and for places the kinds to show, several at a time. */
  toggleMenu(id: SectionMenu) {
    const wasOpen = this.rowMenu === id;
    this.closeRowMenu();
    if (wasOpen) return;
    this.rowMenu = this.menu = id;
  }
  menuGroups() {
    const item = (role: "menuitemradio" | "menuitemcheckbox", label: string, icon: string, checked: boolean, action: () => void) =>
      ({ role, label, icon, checked, action });
    const pick = () => this.closeRowMenu();
    if (this.menu === "routes-order")
      return [{ label: t("Order"), items: (Object.entries(routeOrders) as [keyof typeof routeOrders, string][]).map(([order, label]) =>
        item("menuitemradio", label, icons[order], order === this.routeOrder, () => {
          setPreference("route-order", this.routeOrder = order);
          pick();
        })) }];
    return [
      { label: t("Order"), items: (Object.entries(placeOrders) as [keyof typeof placeOrders, string][]).map(([order, label]) =>
        item("menuitemradio", label, icons[order], order === this.placeOrder, () => {
          setPreference("place-order", this.placeOrder = order);
          pick();
        })) },
      { label: t("Type"), items: [
        item("menuitemcheckbox", t("All types"), icons.pin, !this.placeKinds.size, () => this.placeKinds.clear()),
        ...this.savedKinds().map((kind) => item("menuitemcheckbox", markerKinds[kind].label, placeIcon(kind), this.placeKinds.has(kind), () => {
          if (!this.placeKinds.delete(kind)) this.placeKinds.add(kind);
        })),
      ] },
    ];
  }
  /** Each kind of place saved here, in the picker's order. */
  private savedKinds() {
    const kinds = new Set(this.state.markers.map((marker) => marker.kind));
    return (Object.keys(markerKinds) as Kind[]).filter((kind) => kinds.has(kind));
  }
  // Dismiss without rebuilding rows: pointerdown must not remove the pending click target.
  closeRowMenu() {
    this.rowMenu = undefined;
    if (this.confirming && this.confirming !== "cancel-route") {
      clearTimeout(this.confirmTimer);
      this.confirming = undefined;
    }
  }
  // Two taps to delete: the first arms the button for a few seconds.
  private deleteAction(key: string, action: () => void): SheetAction {
    const armed = this.confirming === key;
    return {
      label: armed ? t("Tap again to delete") : t("Delete"),
      icon: icons.trash,
      danger: true,
      armed,
      stay: true,
      action: () => {
        clearTimeout(this.confirmTimer);
        if (this.confirming === key) {
          this.confirming = undefined;
          this.closeRowMenu();
          return action();
        }
        this.confirming = key;
        this.confirmTimer = setTimeout(() => (this.confirming = undefined), 3000);
      },
    };
  }
  private armCardDelete(armed?: CardDelete) {
    this.cardDeleteArmed = armed;
    clearTimeout(this.cardDeleteTimer);
    if (armed) this.cardDeleteTimer = setTimeout(() => this.armCardDelete(), 3000);
  }
  refreshMetadata() {
    this.refresh();
  }
  // Keep detection status available to assistive technology while indexing;
  // a running scan also passes its progress, from 0 to 1, for the top toast.
  /** `left` is the scan's estimated time left, shown beside its percentage. */
  updateOcr(index: OcrIndex | undefined, message = "", progress?: number, left = "") {
    // The library reloads the index from storage on each refresh: the same scan
    // keeps the copy loaded, so search keeps its place and its cached word spans.
    const sameIndex = this.ocr === index ||
      (!!this.ocr && this.ocr.mapId === index?.mapId && this.ocr.completedAt === index.completedAt);
    if (!sameIndex) this.ocr = index;
    this.ocrMessage = message;
    this.ocrProgress = progress === undefined ? undefined : { percent: Math.floor(progress * 100), left };
    this.renderSearch(sameIndex || !!this.searchTimer);
  }
  // Typing coalesces into one search; clearing and result navigation apply immediately.
  queueSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    if (!normalizeText(this.query)) return this.renderSearch();
    this.searchTimer = setTimeout(() => {
      this.renderSearch();
      this.bringMatchIntoView();
    }, SEARCH_DEBOUNCE_MS);
  }
  // Like find-in-page: when no result is anywhere on screen, typing brings the
  // first one into view instead of leaving a dimmed map and a count.
  private bringMatchIntoView() {
    const showing = this.viewer?.showing;
    const first = this.searchMatches[0];
    if (!first || !showing) return;
    if (this.searchMatches.some((match) => showing.call(this.viewer, matchPoints(match)))) return;
    this.frameMatch(first);
  }
  private frameMatch(match: MapSearchMatch) {
    if (match.marker) this.viewer?.jumpTo(match.marker.point);
    else this.viewer?.fitPoints(matchPoints(match));
  }
  private renderSearch(statusOnly = false) {
    if (!statusOnly) {
      clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
      this.searchQuery = this.query;
      this.searchMatches = searchMap(this.ocr, this.state.markers, this.searchQuery);
      this.searchPosition = -1;
      this.viewer?.setSearch?.(this.searchMatches,
        !!normalizeText(this.searchQuery) && (!!this.ocr || !!this.searchMatches.length));
    }
    this.viewer?.refreshLabels?.();
  }
  /** What Search says about its results, and its count, which doubles as Next. */
  searchView() {
    const active = !!normalizeText(this.searchQuery);
    const count = this.searchMatches.length, position = this.searchPosition;
    const stepping = count > 1 && position >= 0;
    const message = active
      ? stepping ? t("Match {current} of {total}", { current: position + 1, total: count })
        : count ? plural(count, "match")
        // One letter searches saved places only (see searchMap).
        : this.ocr && /^\p{L}$/u.test(normalizeText(this.searchQuery)) ? t("Keep typing to search the map’s text.")
        : this.ocr ? t("No matching text or saved places found.") : t("No matching saved places yet.")
      : t("Search map text and saved places. Drag and zoom to explore.");
    const progress = this.ocrMessage || (!this.ocr ? t("Map text isn’t searchable yet. Run text detection in the map’s Advanced settings.") : "");
    return {
      active, count,
      status: progress ? `${message} · ${progress}` : message,
      // A bare grey 0 is easy to miss; a miss says so in words.
      badge: stepping ? `${position + 1} / ${count}` : count ? plural(count, "match") : t("No matches"),
      label: stepping ? t("Match {current} of {total}. Next match", { current: position + 1, total: count }) : plural(count, "result"),
    };
  }
  private focusSearch(delta: number) {
    // Enter never navigates the stale result of an earlier keystroke.
    if (this.searchTimer) {
      this.renderSearch();
      delta = 0;
    }
    const count = this.searchMatches.length;
    if (count) this.showMatch((Math.max(0, this.searchPosition) + delta + count) % count);
  }
  private showMatch(position: number) {
    const match = this.searchMatches[position];
    if (!match) return;
    this.searchPosition = position;
    // The on-screen keyboard goes away so the match is in view.
    this.el("map-search")?.blur();
    this.viewer?.setSearch?.(this.searchMatches, true, position);
    this.renderSearch(true);
    this.frameMatch(match);
  }
  async flush() {
    await this.persistence.flush();
  }
  async prepareForUpdate() {
    await this.persistence.flushForReload();
  }
  /** Reconcile shared imports and replacements made in another window. */
  async refreshImports() {
    const stored = await loadNavigation(this.map.id);
    if (this.controller.signal.aborted) return;
    Object.assign(this.state, preserveUnseenImports(this.state, stored));
    this.changed();
  }
  dispose() {
    // Leaving mid-route keeps a usable route rather than an orphan draft.
    if (this.tool === "route") this.finishRoute();
    // Leaving a match unconfirmed keeps the map where it was.
    if (this.tool === "check") this.state.geo = this.geoBefore;
    this.sheet(undefined);
    if (!document.hidden) this.endVisit();
    clearTimeout(this.searchTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.cardDeleteTimer);
    clearTimeout(this.confirmTimer);
    clearTimeout(this.discardTimer);
    clearTimeout(this.tripClockTimer);
    this.stopCompass();
    this.link.disconnect();
    this.hideToast();
    const saved = this.flush();
    this.controller.abort();
    // Closing now leaves the map alone: it goes too.
    this.close("marker-dialog");
    this.close("name-dialog");
    this.releasePhotos();
    return saved;
  }
}
