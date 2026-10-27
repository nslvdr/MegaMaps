import { keepFormOpen, showDialog } from "./dialog";
import type { MapRecord } from "../types";
import type { Point } from "../viewer/camera";
import type { DarkMode } from "../viewer/appearance";
import { NavigationPersistence, loadNavigation } from "../storage/navigation";
import { loadPhoto, savePhoto } from "../storage/photos";
import { preparePhoto } from "../processing/photo";
import { PhotoViewer } from "./photo-viewer";
import { preserveUnseenImports } from "../sharing/annotations";
import { Viewer, type ViewerOptions } from "../viewer/viewer";
import {
  BRIGHTNESS_LEVELS,
  DEFAULT_DIMMING,
  brightnessPercent,
  insideImage,
  dangerLevel,
  layerNames,
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
import type { TrailPoint, Trip } from "../viewer/trail";
import { lastUpdated, placeChanges, recordEdit } from "../viewer/place-history";
import { allowCompass, compassNeedsPermission, speedDelays, watchCompass, type CompassSpeed } from "../viewer/compass";
import { icons, markerCalloutIcon } from "./icons";
import { changeLine, dangerSteps, logDate, nextName, plural, timeAgo, updatedAgo, waterSteps, type LevelStep } from "./format";
import { locale, t } from "../i18n";
import { preference, setPreference } from "../preferences";
import { orderPlaces, orderRoutes, placeOrders, routeOrders } from "./saved-order";
import { placeIcon } from "./place-icon";
import { wheelChoice, type WheelChoice } from "./hold-wheel";
import { showActionSheet } from "./action-sheet";
import { popoverPosition } from "./popover-position";
import {
  normalizeText,
  ocrLabelAt,
  type OcrIndex,
} from "../ocr/index";
import { matchPoints, searchMap, type MapSearchMatch } from "../viewer/map-search";
import { track } from "../stats";
import { formatDistance, formatMinutes, formatWalk, pathLength, travelSummary } from "../viewer/measure";
const sheets = ["trail", "display", "rotation", "saved", "add"] as const;
/** The place card's Delete and the trail mark's, each armed by a first tap. */
const cardDeletes = ["marker-delete", "mark-delete"] as const;
type CardDelete = (typeof cardDeletes)[number];
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
/** "2:05 PM": when a trip started or ended. */
const clock = (time: number) => new Date(time).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
/** A picked day as a time: today keeps the hour, an earlier day is noon, so it reads the same day anywhere. */
const dayTime = (day: string) => {
  if (day === dayValue(Date.now())) return Date.now();
  const [year, month, date] = day.split("-").map(Number);
  return Math.min(Date.now(), new Date(year!, month! - 1, date, 12).getTime());
};
/** Latest visit first; entries for the same day keep the newest written on top. */
const newestFirst = (log: PlaceLogEntry[]) =>
  log.map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.date - a.entry.date || b.index - a.index)
    .map(({ entry }) => entry);
const copyPoints = (points: Point[]) => points.map((point) => ({ ...point }));
type Sheet = (typeof sheets)[number] | "search";
const SEARCH_DEBOUNCE_MS = 200;
const SPOTLIGHT_MS = 4500;
const rotationModes: Record<RotationMode, { icon: string; label: string }> = {
  free: { icon: icons.freeRotation, label: t("Manual") },
  compass: { icon: icons.compass, label: t("Compass") },
  locked: { icon: icons.rotationLock, label: t("Locked") },
};
const manualModes = ["free", "locked"] as const;
const follows = ["tap", "auto"] as const;
const speeds = Object.keys(speedDelays) as CompassSpeed[];
/** How long a new heading must hold before the map turns to it; Tap waits for a double tap. */
const followDelay = () =>
  preference("compass-follow") === "tap" ? undefined : speedDelays[preference("compass-speed")];
/** Compass mode's compass: off, starting, turning the map, or not reaching it. */
// Every passing message is one pill: a tone sets its icon and outline color.
const toastIcons = {
  done: icons.check,
  quiet: icons.check,
  removed: icons.trash,
  error: icons.alert,
};
type ToastTone = keyof typeof toastIcons;
type CompassStatus = "off" | "waiting" | "on" | "missing" | "blocked";
const COMPASS_WAIT_MS = 3000;
/** Compass mode leaves turns smaller than this, in degrees, alone… */
const COMPASS_STEP = 2;
/** …and waits for readings to hold within this many degrees of their average. */
const COMPASS_HOLD = 15;
/** Height of one north wheel row, as in `.north-track span`. */
const NORTH_ROW_PX = 32;
const darkMessages: Record<DarkMode["kind"], string> = {
  inverted: t("Colors inverted on pure black"),
  deepened: t("Background deepened to black"),
  "already-dark": t("Map is already dark"),
};

// Owns map tools/dialogs and saves; the renderer only knows coordinates/appearance.
export class ViewerControls {
  private viewer?: Pick<
    Viewer,
    "setTool" | "updateNavigation" | "jumpTo" | "fitPoints"
  > &
    Partial<Pick<Viewer, "setMeasure" | "orient" | "straighten" | "setSearch" | "refreshLabels" | "previewPlace" | "pulse" | "reveal" | "showing" | "cover" | "select" | "showTrip" | "showView">>;
  private ocr?: OcrIndex;
  private ocrMessage = t("Preparing text detection…");
  private searchMatches: MapSearchMatch[] = [];
  private searchPosition = -1;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchQuery = "";
  private controller = new AbortController();
  private persistence: NavigationPersistence;
  private tool: Tool = "browse";
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
  /** The past trip whose summary is open. */
  private viewingTrip?: string;
  /** The Trail tool is moving the last mark rather than adding one. */
  private movingMark = false;
  /** The place being moved, and where it was. */
  private movingMarker?: string;
  private moveFrom?: Point;
  private editingMarker?: string;
  /** The route whose name, description and photos are in the form. */
  private editingRoute?: string;
  /** Keep the detail view available while its place or route is being edited. */
  private viewingMarker?: string;
  private viewingRoute?: string;
  /** Editing holds focus in the details card; reading leaves the map usable. */
  private cardModal = false;
  private reopeningCard = false;
  private markerPoint?: Point;
  private autoMarkerName = "";
  /** Printed map text under the place being added, which names it better than a number. */
  private mapLabel?: string;
  private nameAction?: (name: string) => void;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private toastUndo?: () => void;
  private spotlightTimer?: ReturnType<typeof setTimeout>;
  /** Move (a place) or Edit points (a route) saves the form first. */
  private moveAfterSave = false;
  /** The card's Delete waiting for its second tap. */
  private cardDeleteArmed?: CardDelete;
  /** The X armed to discard a form's typing on its second tap. */
  private discarding?: string;
  private discardTimer?: ReturnType<typeof setTimeout>;
  /** The edit form as it opened, to tell whether X would throw anything away. */
  private formStart = "";
  private cardDeleteTimer?: ReturnType<typeof setTimeout>;
  private confirmTimer?: ReturnType<typeof setTimeout>;
  private confirming?: string;
  private rowMenu?: string;
  private rowMenuAnchor?: HTMLElement;
  private rowPopover?: HTMLElement;
  private rowSheet?: HTMLDialogElement;
  /** How Saved lists places and routes, kept for the device. */
  private placeOrder = preference("place-order");
  private routeOrder = preference("route-order");
  /** The kinds of place Saved shows, only while the map is open; none shows every kind. */
  private placeKinds = new Set<MapMarker["kind"]>();
  private openSheet?: Sheet;
  private darkKind: DarkMode["kind"] = "inverted";
  /** New places start as the kind last saved, for runs of entrances or notes. */
  private newMarkerKind: MapMarker["kind"] = "landmark";
  /** Photos in the place form, saved with the place on Save. */
  private formPhotos: string[] = [];
  /** The history in the place form; entries removed here are deleted on Save. */
  private formLog: PlaceLogEntry[] = [];
  /** The water level picked in the form; kept only if the place is saved as flooded. */
  private formWater?: WaterLevel;
  /** The danger level picked in the form; kept only if the place is saved as danger. */
  private formDanger: DangerLevel = 2;
  /** Bumped per form so a photo still being prepared can't land on another place. */
  private formVersion = 0;
  private photoJobs = 0;
  /** Object URLs for the open card, revoked when it closes. */
  private photoURLs = new Map<string, Promise<string | undefined>>();
  private photoViewer?: PhotoViewer;
  private compass: CompassStatus = "off";
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
    private state: NavigationState,
    private onShare?: (item?: { kind: "marker" | "route"; id: string }) => void,
  ) {
    this.persistence = new NavigationPersistence(
      () => this.state,
      () => this.toast(t("Could not save. Free some device storage."), "error"),
    );
    // Touch lock is no longer offered; never restore one from an older save.
    this.state.touchLocked = false;
    // Older slider values use the nearest available preset.
    this.state.dimming = BRIGHTNESS_LEVELS.reduce(
      (closest, level) => Math.abs(level - state.dimming) < Math.abs(closest - state.dimming)
        ? level : closest,
      DEFAULT_DIMMING,
    );
    this.bind();
    this.sheet(undefined);
    this.render();
    if (state.rotationMode === "compass") this.resumeCompass();
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
    return this.root.querySelector<T>(`#${id}`)!;
  }
  private input(id: string) {
    return this.el<HTMLInputElement>(id);
  }
  private dialog(id: string) {
    return this.el<HTMLDialogElement>(id);
  }
  private on(
    target: EventTarget,
    type: string,
    action: (event: Event) => void,
    capture = false,
  ) {
    target.addEventListener(type, action, { signal: this.controller.signal, capture });
  }
  private click(id: string, action: () => void) {
    this.on(this.el(id), "click", action);
  }
  options(): ViewerOptions {
    return {
      navigation: this.state,
      overlay: this.root.querySelector<SVGSVGElement>("#map-overlay")!,
      searchOverlay: this.root.querySelector<SVGSVGElement>("#search-overlay")!,
      labelObstacles: () => {
        const stage = this.el("map-stage").getBoundingClientRect();
        return ["back", "display-chips", "dock", "search-count", "sheet", "tool-bar", "marker-dialog"].flatMap(id => {
          const element = this.el(id);
          if (element.hidden) return [];
          const rect = element.getBoundingClientRect();
          return rect.width && rect.height ? [{
            left: rect.left - stage.left, right: rect.right - stage.left,
            top: rect.top - stage.top, bottom: rect.bottom - stage.top,
          }] : [];
        });
      },
      onView: () => {
        this.persistence.moved();
      },
      onTap: (point) => this.onTap(point),
      onMarker: (marker) => this.showDetails(marker),
      onRoute: (route) => this.showDetails(route),
      onEmptyTap: () => this.closePlaceDetails(),
      onDoubleTap: () => this.orientOnTap(),
      // A result's label flies to that result, like stepping to it.
      onSearchResult: (index) => this.showMatch(index),
      // Long-press opens a wheel under the finger: drag up-left and lift to add
      // a place there, up-right to go back to the last mark, down to mark the
      // trail; lifting in the middle does nothing.
      onHold: (point, screen) => {
        if (this.tool !== "browse") return;
        const wheel = this.el("hold-wheel"), label = this.el("hold-label");
        const marked = this.state.trail.length > 0;
        wheel.style.left = `${screen.x}px`;
        wheel.style.top = `${screen.y}px`;
        wheel.dataset.back = marked ? "on" : "off";
        delete wheel.dataset.choice;
        label.textContent = "";
        wheel.hidden = false;
        // Without a mark, back is named but never lit, so lifting there does nothing.
        const choiceAt = (at: Point) => {
          const choice = wheelChoice(screen, at);
          return choice === "back" && !marked ? undefined : choice;
        };
        return {
          move: (at) => {
            const choice = choiceAt(at), aimed = wheelChoice(screen, at);
            if (choice) wheel.dataset.choice = choice;
            else delete wheel.dataset.choice;
            label.textContent = aimed ? wheelLabels[aimed](marked) : "";
          },
          end: (at) => {
            wheel.hidden = true;
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
        this.renderDark();
      },
    };
  }
  attach(viewer: NonNullable<ViewerControls["viewer"]>) {
    this.viewer = viewer;
    this.input("map-search").value = "";
    this.renderSearch();
    this.render();
  }
  private changed() {
    this.persistence.changed();
    this.viewer?.updateNavigation(this.state);
    if (this.openSheet === "search" && !this.searchTimer) this.renderSearch();
    this.render();
  }
  private toast(message: string, tone: ToastTone, undo?: () => void) {
    const toast = this.el("toast");
    toast.textContent = message;
    this.el("toast-bar").dataset.tone = tone;
    this.el("toast-icon").innerHTML = toastIcons[tone];
    this.toastUndo = undo;
    this.el("toast-undo").hidden = !undo;
    this.showToast(true);
    clearTimeout(this.toastTimer);
    // Long hints stay up longer: 50 ms a character (a word in about 0.3 s), up
    // to 6 s, which is also how long an Undo stays on offer.
    this.toastTimer = setTimeout(() => this.showToast(false),
      undo ? 6000 : Math.min(6000, 1500 + message.length * 50));
  }
  private showToast(shown: boolean) {
    this.el("toast").hidden = this.el("toast-bar").hidden = !shown;
    if (!shown) this.toastUndo = undefined;
  }
  /** The trail grows by one point, and the first starts a trip; a mistaken one
   * can be taken back from the toast. */
  private markTrail(point: Point) {
    const view = this.markedView();
    const mark: TrailPoint = { ...point, time: Date.now(), ...(view && { view }) };
    // A card about the old last mark would now be about the wrong one.
    this.dialog("mark-dialog").close();
    this.state.trail.push(mark);
    this.changed();
    this.toast(this.state.trail.length > 1 ? t("Trail point added") : t("Trip started"), "done", () => {
      this.state.trail = this.state.trail.filter((other) => other.time !== mark.time);
      this.changed();
      this.toast(t("Trail point removed"), "quiet");
    });
  }
  /** Where the map is and how far in, for coming back to it later. */
  private markedView() {
    const view = this.state.view;
    return view && { center: { ...view.center }, scale: view.scale };
  }
  /** The map as it was when the last point was marked; older marks only center. */
  private backToMark() {
    const last = this.state.trail.at(-1);
    if (!last) return;
    if (last.view && this.viewer?.showView) this.viewer.showView(last.view);
    else this.viewer?.jumpTo(last);
  }
  /** The red dot, read first: when it was marked. Edit offers Move and Delete. */
  private showMark() {
    const last = this.state.trail.at(-1);
    if (!last) return;
    this.closePlaceDetails();
    this.sheet(undefined);
    const card = this.dialog("mark-dialog");
    this.el("mark-time").textContent = t("Marked {when}", { when: timeAgo(last.time, Date.now()) });
    this.el("mark-actions").hidden = true;
    this.armCardDelete();
    showDialog(card, false);
    this.viewer?.reveal?.(last, card.offsetTop);
  }
  /** The next tap on the map puts the last mark there instead. */
  private moveMark() {
    this.dialog("mark-dialog").close();
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
    this.toast(t("Mark moved"), "done", () => {
      this.state.trail = this.state.trail.map((other) => other === moved ? before : other);
      this.changed();
      this.toast(t("Mark not moved"), "quiet");
    });
  }
  private deleteMark() {
    const last = this.state.trail.at(-1);
    if (!last) return;
    this.dialog("mark-dialog").close();
    this.state.trail = this.state.trail.slice(0, -1);
    this.changed();
    this.toast(t("Trail point removed"), "removed", () => {
      this.state.trail = [...this.state.trail, last].sort((a, b) => a.time - b.time);
      this.changed();
      this.toast(t("Trail point restored"), "done");
    });
  }
  /** Ending a trip keeps it in Past trips and shows how it went. A single point
   * never went anywhere, so it just ends. Either way it can be taken back. */
  private endTrip() {
    const points = this.state.trail;
    if (!points.length) return;
    const trip = points.length > 1 ? { id: crypto.randomUUID(), points, ended: Date.now() } : undefined;
    this.dialog("mark-dialog").close();
    this.state.trail = [];
    if (trip) {
      this.state.trips.push(trip);
      track("trip_ended", { minutes: Math.round((trip.ended - points[0]!.time) / 60_000), points: points.length });
    }
    this.sheet(undefined);
    this.changed();
    if (trip) this.showTrip(trip);
    this.toast(t("Trip ended"), trip ? "done" : "removed", () => {
      if (trip) this.state.trips = this.state.trips.filter((other) => other.id !== trip.id);
      if (trip && this.viewingTrip === trip.id) this.dialog("trip-dialog").close();
      this.state.trail = points;
      this.changed();
      this.toast(t("Trip restored"), "done");
    });
  }
  /** A past trip, whole on the map above a card of how far and how long. */
  private showTrip(trip: Trip) {
    this.closePlaceDetails();
    const card = this.dialog("trip-dialog");
    const start = trip.points[0]!;
    this.viewingTrip = trip.id;
    this.el("trip-title").textContent = this.tripName(trip);
    this.el("trip-times").textContent = `${clock(start.time)} – ${clock(trip.ended)}`;
    const scale = this.state.metresPerPixel;
    this.el("trip-distance").textContent = scale ? formatDistance(pathLength(trip.points) * scale) : "–";
    this.el("trip-duration").textContent = formatMinutes(Math.round((trip.ended - start.time) / 60_000));
    this.el("trip-points").textContent = String(trip.points.length);
    showDialog(card, false);
    this.viewer?.showTrip?.(trip.points);
    this.viewer?.cover?.(card.offsetTop);
    this.viewer?.fitPoints(trip.points);
  }
  private tripName(trip: Trip) {
    return t("Trip {date}", { date: logDate(trip.points[0]!.time) });
  }
  /** Deletes stay two taps, and a few seconds to change your mind after. */
  private deleted(label: string, restore: () => void) {
    this.toast(t("{name} deleted", { name: label }), "removed", () => {
      restore();
      this.changed();
      this.toast(t("{name} restored", { name: label }), "done");
    });
  }
  private sheet(name: Sheet | undefined) {
    const previous = this.openSheet;
    if (previous === "search" && name !== "search") {
      if (normalizeText(this.searchQuery))
        track("search_used", { results: this.searchMatches.length, places: this.searchMatches.some((match) => match.marker) });
      this.input("map-search").blur();
      this.input("map-search").value = "";
      this.renderSearch();
    }
    this.openSheet = name;
    // A panel replaces the place being read.
    if (name) this.closePlaceDetails();
    // Row menus start closed each time a panel opens.
    if (name !== previous) this.closeRowMenu();
    this.el("sheet").hidden = !name || name === "search";
    // Tints each panel with its control's neon color.
    this.el("sheet").dataset.panel = name ?? "";
    this.el("sheet-dismiss").hidden = !name || name === "search";
    this.el("close-sheet").hidden = name === "search";
    this.el("share-saved").hidden = name !== "saved" || !this.onShare;
    this.el("reset-rotation").hidden = name !== "rotation" || this.state.rotationMode === "compass";
    this.el("sheet-title-icon").innerHTML =
      name === "display" ? icons.sun
      : name === "trail" ? icons.trail
      : name === "rotation" ? rotationModes[this.state.rotationMode].icon
      : name === "add" ? icons.add : icons.saved;
    this.el("search-close").hidden = name !== "search";
    this.input("map-search").setAttribute("aria-expanded", String(name === "search"));
    for (const sheet of sheets) {
      const panel = this.el(`sheet-${sheet}`);
      panel.hidden = sheet !== name;
      if (sheet === name)
        this.el("sheet-title").textContent = panel.dataset.title ?? "";
      this.el(`open-${sheet}`).setAttribute(
        "aria-expanded",
        String(sheet === name),
      );
    }
    this.root.querySelector<HTMLElement>(".sheet-content")!.scrollTop = 0;
    // A hidden wheel cannot scroll, so it finds its degree once it shows.
    if (name === "rotation") this.renderRotation();
    // Lists, and how long ago, are worked out as their panel opens; a closed
    // panel keeps no rows, so none can go stale.
    if (name !== previous) for (const id of ["marker-list", "route-list", "trip-list"]) this.el(id).replaceChildren();
    if (name === "saved" || name === "trail") this.render();
    else this.renderTool();
  }
  /** Opens Search ready to type. */
  private openSearch() {
    if (this.tool !== "browse" || this.modalOpen()) return;
    this.sheet("search");
    this.input("map-search").focus();
  }
  /** Next match. Search puts the keyboard away, so the count steps on from there. */
  private stepSearch() {
    if (this.openSheet === "search") this.focusSearch(this.searchPosition < 0 ? 0 : 1);
  }
  private mode(tool: Tool) {
    if (tool !== "trail") this.movingMark = false;
    this.tool = tool;
    this.viewer?.setTool(
      tool,
      tool === "move" ? this.movingMarker : this.activeRoute,
    );
    this.viewer?.setMeasure?.(this.measuring() ? this.tape() : undefined);
    this.sheet(undefined);
    this.renderTool();
  }
  private name(title: string, initial: string, action: (name: string) => void) {
    this.nameAction = action;
    this.el("name-title").textContent = title;
    this.input("name-input").value = initial;
    showDialog(this.dialog("name-dialog"));
    // Ready to type over the name; a tap places the cursor instead.
    this.input("name-input").focus();
    this.input("name-input").select();
  }
  private markerKind() {
    for (const input of this.root.querySelectorAll<HTMLInputElement>(
      'input[name="marker-kind"]',
    ))
      if (input.checked) return input.value as MapMarker["kind"];
    return "landmark";
  }
  private setMarkerKind(kind: MapMarker["kind"]) {
    for (const input of this.root.querySelectorAll<HTMLInputElement>(
      'input[name="marker-kind"]',
    ))
      input.checked = input.value === kind;
  }
  /** Paints the pickers and card for the chosen kind and levels; each picker shows only for its kind. */
  private paintFormKind() {
    const kind = this.markerKind(), levels = { water: this.formWater, danger: this.formDanger };
    this.el("marker-water").hidden = kind !== "flooded";
    this.el("marker-danger").hidden = kind !== "unstable";
    for (const step of this.root.querySelectorAll<HTMLElement>(".level-step"))
      step.setAttribute("aria-pressed", String(step.dataset.water
        ? Number(step.dataset.water) === levels.water
        : Number(step.dataset.danger) === levels.danger));
    this.paintPlaceCard(kind, levels);
    this.el("marker-kind-current").innerHTML =
      `${placeIcon(kind, levels)}<span>${(markerKinds[kind] ?? markerKinds.landmark).label}</span>`;
  }
  private markerName(kind: MapMarker["kind"]) {
    return this.mapLabel ??
      nextName(markerKinds[kind].label, this.state.markers.map((m) => m.label));
  }
  /** Places and routes share one form: a name, a description and photos. */
  private openForm(
    title: string,
    fields: { id?: string; name: string; description?: string; photos?: string[] },
    route?: PlannedRoute,
  ) {
    const card = this.dialog("marker-dialog");
    // Cancel goes back to the details only when they are this item's.
    if (!fields.id || fields.id !== (this.viewingMarker ?? this.viewingRoute))
      this.viewingMarker = this.viewingRoute = undefined;
    card.dataset.mode = "edit";
    this.el("marker-details").hidden = true;
    this.el("marker-edit").hidden = true;
    this.renderPlaceLog();
    this.el("marker-form").hidden = false;
    this.el("marker-dialog-title").textContent = title;
    this.editingRoute = route?.id;
    // A route's look comes from its line, so only places pick an icon.
    this.el("marker-kinds").hidden = !!route;
    this.el("marker-water").hidden = true;
    this.el("marker-danger").hidden = true;
    this.el("marker-move").hidden = true;
    this.el("route-points").hidden = !route;
    this.input("marker-label").value = fields.name;
    this.el<HTMLTextAreaElement>("marker-description").value = fields.description ?? "";
    this.armCardDelete();
    this.formVersion++;
    this.formPhotos = [...(fields.photos ?? [])];
    this.renderFormPhotos();
    this.formLog = [];
    this.renderFormLog();
  }
  private openMarker(title: string, point: Point, marker?: MapMarker) {
    const card = this.dialog("marker-dialog");
    this.editingMarker = marker?.id;
    this.markerPoint = point;
    const kind = marker?.kind ?? this.newMarkerKind;
    this.mapLabel = marker ? undefined : ocrLabelAt(this.ocr, point);
    this.autoMarkerName = marker
      ? ""
      : this.markerName(kind);
    this.openForm(title, { ...marker, name: marker?.label ?? this.autoMarkerName });
    this.setMarkerKind(kind);
    this.formWater = marker?.water;
    this.formDanger = marker?.danger ?? 2;
    this.paintFormKind();
    this.formLog = [...marker?.log ?? []];
    this.renderFormLog();
    this.el("marker-delete").hidden = !marker;
    this.el("marker-move").hidden = !marker;
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
    const spot = this.viewer?.reveal?.(point, card.offsetTop);
    card.style.setProperty("--spot-x", spot ? `${spot.x}px` : "");
    card.style.setProperty("--spot-y", spot ? `${spot.y}px` : "");
  }
  private photoURL(id: string) {
    let url = this.photoURLs.get(id);
    if (!url) {
      url = loadPhoto(this.map.id, id).then((blob) => blob && URL.createObjectURL(blob), () => undefined);
      this.photoURLs.set(id, url);
    }
    return url;
  }
  /** Slots are laid out at once and filled as photos load, so nothing shifts. */
  private photoImage(id: string, alt: string, slot: HTMLElement = this.root.ownerDocument.createElement("img")) {
    const image = slot.tagName === "IMG" ? slot as HTMLImageElement : slot.querySelector("img")!;
    image.alt = alt;
    image.decoding = "async";
    void this.photoURL(id).then((url) => {
      if (url) image.src = url;
      else slot.remove();
    });
    return slot;
  }
  /** Full screen, swiping through the item's photos from the one tapped. */
  private showPhotos(ids: string[], index: number) {
    this.photoViewer ??= new PhotoViewer(this.dialog("photo-viewer"), this.controller.signal);
    this.photoViewer.show(ids.map((id, i) => this.photoImage(id, `Photo ${i + 1} of ${ids.length}`) as HTMLImageElement), index);
  }
  private renderFormPhotos() {
    const list = this.el("marker-photo-list"), count = this.formPhotos.length;
    const add = this.el<HTMLButtonElement>("marker-add-photos");
    // The add tile always comes after the photos.
    const addItem = add.parentElement!;
    list.replaceChildren(...this.formPhotos.map((id, index) => {
      const item = this.root.ownerDocument.createElement("li");
      item.append(this.root.ownerDocument.createElement("img"));
      const remove = this.root.ownerDocument.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.innerHTML = icons.close;
      remove.setAttribute("aria-label", t("Remove photo {number}", { number: index + 1 }));
      remove.title = t("Remove photo");
      this.on(remove, "click", () => {
        this.formPhotos = this.formPhotos.filter((photo) => photo !== id);
        this.renderFormPhotos();
      });
      item.append(remove);
      return this.photoImage(id, `Photo ${index + 1} of ${count}`, item);
    }), addItem);
    const busy = this.photoJobs > 0;
    add.disabled = busy;
    add.title = busy ? t("Adding photos…") : t("Add photos");
    add.setAttribute("aria-label", add.title);
    this.renderSave();
  }
  /** Save waits for a name and for photos still being prepared. */
  private renderSave() {
    this.el<HTMLButtonElement>("marker-save").disabled =
      this.photoJobs > 0 || !this.input("marker-label").value.trim();
  }
  /** What the edit form holds, compared with how it opened. */
  private formState() {
    return JSON.stringify([
      this.input("marker-label").value, this.el<HTMLTextAreaElement>("marker-description").value,
      this.markerKind(), this.formWater, this.formDanger,
      this.formPhotos, this.formLog.map((entry) => entry.id),
    ]);
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
    if (this.discarding) this.paintClose(this.discarding, false);
    this.discarding = id;
    clearTimeout(this.discardTimer);
    if (!id) return;
    this.paintClose(id, true);
    this.discardTimer = setTimeout(() => this.armDiscard(), 3000);
  }
  private paintClose(id: string, armed: boolean) {
    const button = this.el(id), label = armed ? t("Discard?") : t("Close");
    button.classList.toggle("armed", armed);
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  /** The level's field under its kind's symbol, then every step with its own symbol; the place's
   * own step is filled in its colour. */
  private levelScale(kind: "flooded" | "unstable", field: string, steps: LevelStep[], at: number) {
    const document = this.root.ownerDocument;
    const name = document.createElement("span");
    name.className = "level-field";
    name.innerHTML = markerCalloutIcon(kind);
    name.append(field);
    const scale = document.createElement("span");
    scale.className = "level-scale";
    scale.append(...steps.map(({ level, label, color, symbol }) => {
      const step = document.createElement("span");
      step.innerHTML = symbol;
      step.append(label);
      if (level === at) {
        step.setAttribute("aria-current", "true");
        step.style.setProperty("--level", color);
      }
      return step;
    }));
    return [name, scale];
  }
  /** The history as a timeline, newest first. Each entry shows its kind as an icon on the line, its
   * kind, who did it when it came from someone else, and date, then its note or a line per change.
   * Reading ends where the place was added; editing can remove entries. */
  private logItems(log: PlaceLogEntry[], { added, remove }: { added?: Pick<MapMarker, "created" | "by">; remove?: (entry: PlaceLogEntry) => void }) {
    const document = this.root.ownerDocument;
    const kinds = {
      edit: { icon: icons.edit, label: t("Edited"), by: (name: string) => t("Edited by {name}", { name }) },
      note: { icon: icons.note, label: t("Note"), by: (name: string) => t("Note by {name}", { name }) },
      visit: { icon: icons.visit, label: t("Visited"), by: (name: string) => t("Visited by {name}", { name }) },
      added: { icon: icons.added, label: t("Added"), by: (name: string) => t("Added by {name}", { name }) },
    };
    const item = (kind: keyof typeof kinds, time: number, by?: string, body?: HTMLElement) => {
      const entry = document.createElement("li"), node = document.createElement("span");
      entry.dataset.kind = kind;
      node.className = "log-node";
      node.innerHTML = kinds[kind].icon;
      const content = document.createElement("div"), head = document.createElement("p");
      const label = document.createElement("strong"), date = document.createElement("time");
      head.className = "log-head";
      label.textContent = by ? kinds[kind].by(by) : kinds[kind].label;
      date.dateTime = new Date(time).toISOString();
      date.textContent = logDate(time);
      head.append(label, date);
      content.append(head, ...body ? [body] : []);
      entry.append(node, content);
      return entry;
    };
    const items = newestFirst(log).map((entry) => {
      let body: HTMLElement | undefined;
      if (entry.changes) {
        body = document.createElement("ul");
        body.className = "log-changes";
        body.append(...entry.changes.map(changeLine).map(({ field, from, to, detail }) => {
          const line = document.createElement("li"), name = document.createElement("span");
          name.textContent = field;
          line.append(name);
          if (from) line.append(from);
          if (from && to) line.insertAdjacentHTML("beforeend", icons.next);
          if (to) line.append(to);
          if (detail) line.append(detail);
          return line;
        }));
      } else if (entry.text) {
        body = document.createElement("p");
        body.className = "log-text";
        body.textContent = entry.text;
      }
      const shown = item(entry.changes ? "edit" : entry.text ? "note" : "visit", entry.date, entry.by, body);
      if (remove) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "log-remove";
        button.innerHTML = icons.close;
        button.setAttribute("aria-label", t("Remove entry from {date}", { date: logDate(entry.date) }));
        button.title = t("Remove entry");
        this.on(button, "click", () => remove(entry));
        shown.append(button);
      }
      return shown;
    });
    return added === undefined ? items : [...items, item("added", added.created, added.by)];
  }
  private renderFormLog() {
    this.el("marker-log-edit").replaceChildren(...this.logItems(this.formLog, { remove: (entry) => {
      this.formLog = this.formLog.filter((other) => other !== entry);
      this.renderFormLog();
    } }));
    this.el("marker-log-field").hidden = !this.formLog.length;
  }
  /** When the place was last updated, under its title, and its history under the description,
   * ending where it was added; a place from someone else shows who added it even without history. */
  private renderPlaceLog(place?: MapMarker) {
    this.el("marker-detail-updated").hidden = !place;
    this.el("marker-add-entry").hidden = !place;
    this.el("marker-detail-log").hidden = !place?.log?.length && !place?.by;
    if (!place) return;
    this.el("marker-detail-updated").textContent = updatedAgo(lastUpdated(place));
    this.el("marker-log-list").replaceChildren(...this.logItems(place.log ?? [], { added: place }));
  }
  /** Opens on today, ready to type a note; Add with none records a visit. */
  private openLogEntry() {
    const date = this.input("entry-date");
    date.value = date.max = dayValue(Date.now());
    this.el<HTMLTextAreaElement>("entry-text").value = "";
    this.armDiscard();
    showDialog(this.dialog("entry-dialog"));
    this.el("entry-text").focus();
  }
  /** Photos are shrunk and stored as they are picked; the item keeps them on Save. */
  private async addPhotos(files: File[]) {
    const version = this.formVersion;
    this.photoJobs++;
    this.renderFormPhotos();
    let failed = 0;
    try {
      for (const file of files) {
        try {
          const id = await savePhoto(this.map.id, await preparePhoto(file));
          if (version !== this.formVersion) return;
          this.formPhotos.push(id);
          this.renderFormPhotos();
        } catch {
          failed++;
        }
      }
    } finally {
      this.photoJobs--;
      this.renderFormPhotos();
    }
    if (failed) this.toast(failed === files.length && failed === 1
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
        // A new point means the pending t("Discard?") no longer applies.
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
  private measuring() {
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
    this.renderTool();
  }
  /** The Measure button opens and closes the tool; a map without a scale asks for one first. */
  private toggleMeasure() {
    if (this.measuring()) return this.closeMeasure();
    if (this.tool !== "browse") return;
    this.closePlaceDetails();
    if (!this.state.metresPerPixel) return showDialog(this.dialog("scale-ask-dialog"));
    this.measureHistory = [];
    this.mode("measure");
    track("measure_used");
  }
  private closeMeasure() {
    this.measurePoints = [];
    this.scalePoints = [];
    this.measureHistory = [];
    this.mode("browse");
  }
  /** Tap both ends of a known length, like the scale bar, then say how long it is. */
  private startScale() {
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
    this.input("scale-metres").value = known ? String(Math.round(pixels * known * 10) / 10) : "";
    this.renderScaleSave();
    showDialog(this.dialog("scale-dialog"));
    this.input("scale-metres").focus();
  }
  private scaleMetres() {
    const metres = Number(this.input("scale-metres").value);
    return metres > 0 && metres <= 100_000 ? metres : undefined;
  }
  private renderScaleSave() {
    this.el<HTMLButtonElement>("scale-save").disabled = !this.scaleMetres();
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
  // A route is only kept with at least two points; Done always leaves it finished.
  private finishRoute() {
    const route = this.route(),
      before = this.routeBefore;
    this.activeRoute = undefined;
    this.routeBefore = undefined;
    this.routeStart = undefined;
    this.routeHistory = [];
    if (route) {
      if (route.points.length < 2 && before) {
        route.points = before;
        route.draft = false;
        this.toast(t("{name} unchanged", { name: route.name }), "quiet");
      } else if (route.points.length >= 2) {
        route.draft = false;
        this.toast(t("{name} saved · {points}", { name: route.name, points: plural(route.points.length, "point") }), "done");
      } else {
        this.state.routes = this.state.routes.filter((r) => r.id !== route.id);
        if (route.points.length)
          this.toast(t("Route discarded: it needs at least 2 points"), "removed");
      }
      this.changed();
    }
    this.mode("browse");
  }
  // × while drawing: drop this session's points. A new route goes away;
  // continued or edited ones return to how they were. Real work asks twice.
  private cancelRoute() {
    const route = this.route(),
      start = this.routeStart;
    if (!route || !start) return this.finishRoute();
    const changed =
      JSON.stringify(route.points) !== JSON.stringify(start.points);
    if (changed && route.points.length >= 2 && this.confirming !== "cancel-route") {
      this.confirming = "cancel-route";
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => {
        this.confirming = undefined;
        this.renderTool();
      }, 3000);
      this.renderTool();
      return;
    }
    clearTimeout(this.confirmTimer);
    this.confirming = undefined;
    this.activeRoute = undefined;
    this.routeBefore = undefined;
    this.routeStart = undefined;
    this.routeHistory = [];
    if (!start.points.length)
      this.state.routes = this.state.routes.filter((r) => r.id !== route.id);
    else {
      route.points = start.points;
      route.draft = start.draft;
    }
    if (changed)
      this.toast(
        start.points.length ? t("{name} unchanged", { name: route.name }) : t("Route discarded"),
        start.points.length ? "quiet" : "removed",
      );
    this.changed();
    this.mode("browse");
  }
  private movingPlace() {
    return this.tool === "move"
      ? this.state.markers.find((m) => m.id === this.movingMarker)
      : undefined;
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
    const marker = this.movingPlace(),
      from = this.moveFrom;
    this.movingMarker = undefined;
    this.moveFrom = undefined;
    if (marker && from) {
      const moved = marker.point.x !== from.x || marker.point.y !== from.y;
      if (!keep) marker.point = from;
      else if (moved) recordEdit(marker, [{ field: "point" }]);
      if (moved) {
        this.toast(
          keep ? t("{name} moved", { name: marker.label }) : t("{name} not moved", { name: marker.label }),
          keep ? "done" : "quiet",
        );
        this.changed();
      }
    }
    this.mode("browse");
  }
  private editMarker(marker: MapMarker) {
    this.openMarker(t("Edit place"), marker.point, marker);
    // Under the card's shade every pin looks alike; this one says it's the one.
    this.viewer?.pulse?.(marker.id);
  }
  private editRouteDetails(route: PlannedRoute) {
    const card = this.dialog("marker-dialog");
    this.editingMarker = undefined;
    this.markerPoint = undefined;
    this.openForm(t("Edit route"), route, route);
    this.paintCard(this.routeIcon(route), routeColor(this.state, route.id));
    this.el("marker-delete").hidden = false;
    this.presentCard(true);
    this.viewer?.cover?.();
    card.style.setProperty("--spot-x", "");
    card.style.setProperty("--spot-y", "");
    this.viewer?.pulse?.(route.id);
  }
  /** The card wears its item's icon, and that icon's colour as its accent. */
  private paintCard(icon: string, color: string) {
    this.el("marker-dialog-title-icon").innerHTML = icon;
    this.dialog("marker-dialog").style.setProperty("--c", color);
  }
  private paintPlaceCard(kind: MapMarker["kind"], levels?: Pick<MapMarker, "water" | "danger">) {
    const color = placeColor({ kind, danger: levels?.danger });
    this.paintCard(placeIcon(kind, levels), color);
    this.dialog("kind-dialog").style.setProperty("--c", color);
    this.dialog("entry-dialog").style.setProperty("--c", color);
  }
  private routeIcon(route: PlannedRoute) {
    return icons.route.replace("<svg ", `<svg style="color:${routeColor(this.state, route.id)}" `);
  }
  /** The place or route whose details are open. */
  private viewedItem() {
    return this.state.markers.find((m) => m.id === this.viewingMarker) ??
      this.state.routes.find((r) => r.id === this.viewingRoute);
  }
  /** Read a saved place or route first, keeping editing behind an explicit action. */
  private showDetails(item: MapMarker | PlannedRoute) {
    this.sheet(undefined);
    this.dialog("trip-dialog").close();
    this.dialog("mark-dialog").close();
    const card = this.dialog("marker-dialog");
    const place = "label" in item ? item : undefined;
    this.viewingMarker = place?.id;
    this.viewingRoute = place ? undefined : item.id;
    card.dataset.mode = "view";
    this.el("marker-form").hidden = true;
    const edit = this.el("marker-edit");
    edit.hidden = false;
    edit.title = place ? t("Edit place") : t("Edit route");
    edit.setAttribute("aria-label", edit.title);
    this.el("marker-dialog-title").textContent = "label" in item ? item.label : item.name;
    if ("label" in item) this.paintPlaceCard(item.kind, item);
    else this.paintCard(this.routeIcon(item), routeColor(this.state, item.id));
    const description = this.el("marker-detail-description");
    description.textContent = item.description ?? "";
    description.hidden = !item.description;
    const photos = this.el("marker-detail-photos"), count = item.photos?.length ?? 0;
    photos.replaceChildren(...(item.photos ?? []).map((id, index) => {
      const open = this.root.ownerDocument.createElement("button");
      open.type = "button";
      open.title = t("View full screen");
      open.append(this.root.ownerDocument.createElement("img"));
      this.on(open, "click", () => this.showPhotos(item.photos!, index));
      return this.photoImage(id, `Photo ${index + 1} of ${count}`, open);
    }));
    photos.hidden = !count;
    photos.scrollLeft = 0;
    const water = place?.kind === "flooded" ? place.water : undefined;
    const danger = place && dangerLevel(place);
    const levelLine = this.el("marker-detail-level");
    levelLine.replaceChildren(...water ? this.levelScale("flooded", t("Water level"), waterSteps, water)
      : danger ? this.levelScale("unstable", t("Danger level"), dangerSteps, danger) : []);
    levelLine.hidden = !water && !danger;
    this.renderPlaceLog(place);
    // A route's length and walking time sit under its name, where a place says when it was updated,
    // followed by who drew it when it came from someone else.
    if ("points" in item) {
      const summary = [travelSummary(item.points, this.state.metresPerPixel),
        item.by && t("Added by {name}", { name: item.by })].filter(Boolean).join(" · ");
      this.el("marker-detail-updated").textContent = summary;
      this.el("marker-detail-updated").hidden = !summary;
    }
    const details = this.el("marker-details");
    details.setAttribute("aria-label", place ? t("Place details") : t("Route details"));
    // With nothing to read, the card shrinks to its header.
    details.hidden = !item.description && !count && levelLine.hidden && this.el("marker-detail-log").hidden;
    details.scrollTop = 0;
    this.presentCard(false);
    this.markMoreDetails();
    // The map stays full size behind the pane; the item centers above it.
    this.viewer?.cover?.(card.offsetTop);
    this.frame(item);
    this.viewer?.select?.(item.id);
    this.viewer?.pulse?.(item.id);
    this.viewer?.refreshLabels?.();
  }
  /** Flags details that continue below the card's edge, for the pulsing hint. */
  private markMoreDetails() {
    const details = this.el("marker-details");
    details.dataset.more = String(details.scrollHeight - details.scrollTop - details.clientHeight > 1);
  }
  /** A place centers without zooming out; a route fits whole. */
  private frame(item: MapMarker | PlannedRoute) {
    if ("label" in item) this.viewer?.jumpTo(item.point, 1);
    else this.viewer?.fitPoints(item.points);
  }
  private presentCard(modal: boolean) {
    const card = this.dialog("marker-dialog");
    this.armDiscard();
    if (modal) this.formStart = this.formState();
    if (card.hasAttribute("open") && this.cardModal === modal) {
      this.el("marker-dialog-title").focus({ preventScroll: true });
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
  private closePlaceDetails() {
    const trip = this.dialog("trip-dialog"), mark = this.dialog("mark-dialog");
    const wasTrip = trip.hasAttribute("open") || mark.hasAttribute("open");
    trip.close();
    mark.close();
    const card = this.dialog("marker-dialog");
    if (!card.hasAttribute("open") || this.cardModal) return wasTrip;
    card.close();
    return true;
  }
  private modalOpen() {
    return !!this.root.querySelector('dialog[open]:not(.place-card[data-mode="view"])');
  }
  /** Cancel an edit back to its unchanged detail view, or close a form opened elsewhere. */
  private cancelMarkerEdit() {
    const item = this.viewedItem();
    if (this.dialog("marker-dialog").dataset.mode === "edit" && item)
      this.showDetails(item);
    else this.dialog("marker-dialog").close();
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
  private saveRoute(route: PlannedRoute) {
    const name = this.input("marker-label").value.trim();
    if (!name) return;
    const description = this.el<HTMLTextAreaElement>("marker-description").value.trim();
    const unchanged = route.name === name && (route.description ?? "") === description &&
      (route.photos ?? []).join() === this.formPhotos.join();
    route.name = name;
    if (description) route.description = description;
    else delete route.description;
    if (this.formPhotos.length) route.photos = [...this.formPhotos];
    else delete route.photos;
    const returnToDetails = this.viewingRoute === route.id && !this.moveAfterSave;
    if (!returnToDetails) this.dialog("marker-dialog").close();
    if (!unchanged) this.changed();
    if (this.moveAfterSave) {
      this.editRoute(route);
      return;
    }
    if (returnToDetails) this.showDetails(route);
    this.toast(unchanged ? t("{name} unchanged", { name }) : t("{name} updated", { name }), unchanged ? "quiet" : "done");
  }
  private spotlight() {
    const stage = this.el("map-stage");
    const count = this.state.routes.length + this.state.markers.length;
    this.sheet(undefined);
    if (!count) return;
    clearTimeout(this.spotlightTimer);
    // Restart the CSS animation when pressed again.
    stage.classList.remove("spotlight");
    void stage.offsetWidth;
    stage.classList.add("spotlight");
    this.el("spotlight").classList.add("active");
    this.spotlightTimer = setTimeout(() => {
      stage.classList.remove("spotlight");
      this.el("spotlight").classList.remove("active");
    }, SPOTLIGHT_MS);
  }
  private bind() {
    // Exploring the map dismisses the keyboard but preserves the query and matches.
    this.on(this.el("map-canvas"), "pointerdown", () => {
      if (this.openSheet === "search") this.input("map-search").blur();
    });
    this.on(this.input("map-search"), "input", () => this.queueSearch());
    // The persistent field opens Search when tapped.
    this.on(this.input("map-search"), "focus", () => {
      if (this.openSheet !== "search") this.openSearch();
    });
    this.on(this.el("open-search"), "click", (event) => {
      if ((event.target as Element).closest("button")) return;
      if (this.openSheet !== "search") this.openSearch();
    });
    this.click("search-count", () => this.stepSearch());
    // Close clears the query and its map highlights while keeping the field available.
    this.click("search-close", () => this.sheet(undefined));
    this.click("toast-undo", () => this.toastUndo?.());
    // The on-screen keyboard's Search key goes to the first match.
    this.on(this.input("map-search"), "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key === "Enter" && !key.isComposing) {
        key.preventDefault();
        this.stepSearch();
      }
    });
    for (const sheet of ["trail", "display", "rotation", "saved"] as const)
      this.click(`open-${sheet}`, () =>
        this.sheet(this.openSheet === sheet ? undefined : sheet),
      );
    this.click("close-sheet", () => this.sheet(undefined));
    this.click("reset-rotation", () => this.viewer?.straighten?.());
    this.click("sheet-dismiss", () => this.sheet(undefined));
    this.on(this.input("dark-map"), "change", () => {
      this.state.inverted = this.input("dark-map").checked;
      this.changed();
    });
    for (const layer of layerNames)
      this.on(this.input(`layer-${layer}`), "change", () => {
        this.state.layers[layer] = this.input(`layer-${layer}`).checked;
        this.changed();
      });
    this.click("spotlight", () => this.spotlight());
    for (const mode of manualModes) {
      const input = this.input(`rotation-${mode}`);
      this.on(input, "change", () => {
        if (input.checked) this.setRotationMode(mode);
      });
    }
    // Tap and Auto pick Compass mode and how it follows. Following reads the
    // choice each time, so a change applies at once.
    for (const follow of follows) {
      const input = this.input(`compass-follow-${follow}`);
      // Tapping a compass tile again retries a compass that needs permission or went missing.
      this.click(`compass-follow-${follow}`, () => {
        if (this.state.rotationMode === "compass" && (this.compass === "missing" || this.compass === "blocked"))
          void this.startCompass(true);
      });
      this.on(input, "change", () => {
        if (!input.checked) return;
        setPreference("compass-follow", follow);
        if (this.state.rotationMode === "compass") this.renderRotation();
        else this.setRotationMode("compass");
      });
    }
    for (const speed of speeds) {
      const input = this.input(`compass-speed-${speed}`);
      this.on(input, "change", () => {
        if (!input.checked) return;
        setPreference("compass-speed", speed);
        this.renderRotation();
      });
    }
    // Scrolling the wheel turns the map as each degree passes the middle.
    const wheel = this.el("north-offset");
    this.on(wheel, "scroll", () => {
      const degrees = Math.round(wheel.scrollTop / NORTH_ROW_PX) + NORTH_MIN;
      if (degrees !== this.state.northOffset) this.setNorth(degrees);
    });
    for (const level of BRIGHTNESS_LEVELS) {
      const input = this.input(`brightness-${brightnessPercent(level)}`);
      this.on(input, "change", () => {
        if (!input.checked) return;
        this.state.dimming = level;
        this.changed();
      });
    }
    // Reading a place, a press anywhere off the card and the map closes it; the
    // map closes it on a tap, so it can still pan and zoom.
    this.on(document, "pointerdown", (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("dialog") || target === this.el("map-canvas")) return;
      this.closePlaceDetails();
    });
    // Tapping anywhere outside an open row menu closes it.
    this.on(document, "pointerdown", (event) => {
      if (!this.rowMenu) return;
      const target = event.target as Element | null;
      if (target?.closest?.(".row-popover, .row-more, .section-menu, .action-sheet")) return;
      this.closeRowMenu();
    });
    this.on(this.root.querySelector(".sheet-content")!, "scroll", () =>
      this.closeRowMenu(),
    );
    this.on(window, "resize", () => this.closeRowMenu());
    if (window.visualViewport)
      this.on(window.visualViewport, "resize", () => this.closeRowMenu());
    this.on(this.el("sheet"), "animationend", () => {
      this.positionRowMenu();
      this.viewer?.refreshLabels?.();
    });
    this.on(document, "visibilitychange", () => {
      if (document.hidden) void this.flush();
    });
    this.on(window, "pagehide", () => {
      void this.flush();
    });
    this.click("open-measure", () => this.toggleMeasure());
    for (const id of ["scale-ask-close", "scale-ask-later"])
      this.click(id, () => this.dialog("scale-ask-dialog").close());
    this.click("scale-ask-start", () => {
      this.dialog("scale-ask-dialog").close();
      this.startScale();
    });
    this.click("scale-cancel", () => this.dialog("scale-dialog").close());
    this.on(this.input("scale-metres"), "input", () => this.renderScaleSave());
    this.on(this.el("scale-form"), "submit", (event) => {
      event.preventDefault();
      const metres = this.scaleMetres(), pixels = pathLength(this.scalePoints);
      if (!metres || !pixels) return;
      this.state.metresPerPixel = metres / pixels;
      this.dialog("scale-dialog").close();
      this.scalePoints = [];
      this.measureHistory = [];
      this.changed();
      this.mode("measure");
      this.toast(t("Scale set"), "done");
    });
    this.click("open-add", () =>
      this.sheet(this.openSheet === "add" ? undefined : "add"),
    );
    // The task card's X cancels: a route is dropped, a moved place goes back.
    this.click("tool-cancel", () => {
      if (this.tool === "route") this.cancelRoute();
      else if (this.tool === "measure") this.closeMeasure();
      else if (this.tool === "scale") this.cancelScale();
      else if (this.tool === "move") this.finishMove(false);
      else this.mode("browse");
    });
    this.click("tool-rename", () => {
      if (this.tool === "measure") return this.startScale();
      const route = this.route();
      if (route)
        this.name(t("Rename route"), route.name, (name) => {
          route.name = name;
          this.changed();
        });
    });
    this.click("add-marker", () => this.mode("marker"));
    this.click("trip-start", () => this.mode("trail"));
    this.click("trip-end", () => this.endTrip());
    this.click("trip-back", () => {
      this.sheet(undefined);
      this.backToMark();
    });
    this.click("mark-close", () => this.dialog("mark-dialog").close());
    this.click("mark-edit", () => {
      const actions = this.el("mark-actions");
      actions.hidden = !actions.hidden;
      this.armCardDelete();
    });
    this.click("mark-move", () => this.moveMark());
    this.click("mark-delete", () => {
      if (this.cardDeleteArmed !== "mark-delete") return this.armCardDelete("mark-delete");
      this.armCardDelete();
      this.deleteMark();
    });
    this.click("trip-close", () => this.dialog("trip-dialog").close());
    // The trip leaves the map with its card. Closing to show another trip
    // reopens the card before this runs, so it is left alone.
    this.on(this.dialog("trip-dialog"), "close", () => {
      if (this.dialog("trip-dialog").hasAttribute("open")) return;
      this.viewingTrip = undefined;
      this.viewer?.showTrip?.();
      if (!this.dialog("marker-dialog").hasAttribute("open")) this.viewer?.cover?.();
    });
    this.click("share-saved", () => this.onShare?.());
    for (const id of ["routes-order", "places-order"] as const)
      this.click(id, () => {
        const wasOpen = this.rowMenu === id;
        this.closeRowMenu();
        if (wasOpen) return;
        this.rowMenu = id;
        this.savedMenu(id);
        this.positionRowMenu();
      });
    // Start drawing immediately; the default name can be changed from Saved.
    this.click("add-route", () => {
      const route: PlannedRoute = {
        id: crypto.randomUUID(),
        name: nextName(t("Route"), this.state.routes.map((r) => r.name)),
        points: [],
        created: Date.now(),
        draft: true,
      };
      this.state.routes.push(route);
      this.editRoute(route);
    });
    this.click("tool-done", () =>
      this.tool === "move" ? this.finishMove(true)
      : this.tool === "scale" ? this.askScaleLength()
      : this.finishRoute(),
    );
    this.click("route-undo", () => {
      if (this.measuring()) {
        const previous = this.measureHistory.pop();
        if (previous) this.setTape(previous);
        else if (!this.tape().pop()) return;
        return this.measured();
      }
      // Steps back through this session's taps and drags; once those run
      // out, it keeps removing the last point.
      const route = this.route();
      const previous = this.routeHistory.pop();
      if (route && previous) route.points = previous;
      else if (route?.points.length) route.points.pop();
      else return;
      this.changed();
    });
    this.click("marker-cancel", () => {
      const editing = this.dialog("marker-dialog").dataset.mode === "edit";
      if (editing && !this.confirmDiscard("marker-cancel", this.formState() !== this.formStart)) return;
      this.cancelMarkerEdit();
    });
    this.click("marker-edit", () => {
      const item = this.viewedItem();
      if (item && "label" in item) this.editMarker(item);
      else if (item) this.editRouteDetails(item);
    });
    this.click("marker-add-entry", () => this.openLogEntry());
    this.on(this.el("marker-details"), "scroll", () => this.markMoreDetails());
    this.click("entry-cancel", () => {
      const typed = !!this.el<HTMLTextAreaElement>("entry-text").value.trim();
      if (this.confirmDiscard("entry-cancel", typed)) this.dialog("entry-dialog").close();
    });
    this.on(this.el("entry-form"), "submit", (event) => {
      event.preventDefault();
      const place = this.viewedItem();
      const text = this.el<HTMLTextAreaElement>("entry-text").value.trim();
      const day = this.input("entry-date").value;
      if (!place || !("label" in place) || !day) return;
      place.log = [...place.log ?? [], { id: crypto.randomUUID(), date: dayTime(day), ...(text ? { text } : {}) }];
      this.dialog("entry-dialog").close();
      this.changed();
      this.showDetails(place);
      this.toast(t(text ? "Note added to {name}" : "Visit added to {name}", { name: place.label }), "done");
    });
    for (const id of ["marker-dialog", "entry-dialog", "name-dialog", "scale-dialog"])
      this.on(this.dialog(id), "cancel", keepFormOpen);
    const label = this.input("marker-label");
    // Next on the name moves on to the description; only Save saves the place.
    this.on(label, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Enter" || key.isComposing) return;
      key.preventDefault();
      this.el("marker-description").focus();
    });
    this.on(label, "input", () => this.renderSave());
    // The first tap on a suggested name selects it, so typing replaces it.
    let labelFocused = false;
    this.on(label, "pointerdown", () => {
      labelFocused = this.root.ownerDocument.activeElement === label;
    });
    this.on(label, "click", () => {
      if (!labelFocused && this.autoMarkerName && label.value === this.autoMarkerName) label.select();
    });
    this.click("marker-add-photos", () => this.input("marker-photo-input").click());
    this.on(this.input("marker-photo-input"), "change", () => {
      const input = this.input("marker-photo-input");
      const files = [...input.files ?? []];
      input.value = "";
      if (files.length) void this.addPhotos(files);
    });
    // Two taps here too, as in the Saved menu: the first arms Delete briefly.
    this.click("marker-delete", () => {
      if (this.cardDeleteArmed !== "marker-delete") {
        this.armCardDelete("marker-delete");
        return;
      }
      this.armCardDelete();
      const route = this.state.routes.find((r) => r.id === this.editingRoute);
      if (route) {
        this.dialog("marker-dialog").close();
        this.deleteRoute(route);
        this.mode("browse");
        return;
      }
      const index = this.state.markers.findIndex((m) => m.id === this.editingMarker);
      const deleted = this.state.markers[index];
      this.state.markers = this.state.markers.filter(
        (m) => m.id !== this.editingMarker,
      );
      this.dialog("marker-dialog").close();
      this.changed();
      this.mode("browse");
      if (deleted) this.deleted(deleted.label, () => this.state.markers.splice(index, 0, deleted));
    });
    this.click("marker-kind-toggle", () => showDialog(this.dialog("kind-dialog")));
    this.click("kind-close", () => this.dialog("kind-dialog").close());
    for (const input of this.root.querySelectorAll<HTMLInputElement>(
      'input[name="marker-kind"]',
    )) {
      // Tapping a pin, even the chosen one, picks it and goes back to the form.
      this.on(input, "click", () => this.dialog("kind-dialog").close());
      this.on(input, "change", () => {
        this.paintFormKind();
        // Keep auto names in sync with the chosen kind until the user types.
        const label = this.input("marker-label");
        if (this.autoMarkerName && label.value === this.autoMarkerName) {
          this.autoMarkerName = this.markerName(this.markerKind());
          label.value = this.autoMarkerName;
        }
        if (!this.editingMarker && this.markerPoint)
          this.viewer?.previewPlace?.({ point: this.markerPoint, kind: this.markerKind() });
      });
    }
    for (const step of this.root.querySelectorAll<HTMLElement>(".level-step"))
      this.on(step, "click", () => {
        if (step.dataset.water) {
          const water = Number(step.dataset.water) as WaterLevel;
          this.formWater = water === this.formWater ? undefined : water;
        } else this.formDanger = Number(step.dataset.danger) as DangerLevel;
        this.paintFormKind();
      });
    this.click("photo-viewer-close", () => this.dialog("photo-viewer").close());
    this.on(this.dialog("marker-dialog"), "close", () => {
      if (this.reopeningCard) {
        this.reopeningCard = false;
        return;
      }
      this.dialog("photo-viewer").close();
      this.viewingMarker = this.viewingRoute = undefined;
      this.viewer?.select?.();
      this.formVersion++;
      for (const url of this.photoURLs.values()) void url.then((url) => url && URL.revokeObjectURL(url));
      this.photoURLs.clear();
      if (!this.viewingTrip) this.viewer?.cover?.();
      this.viewer?.previewPlace?.();
      this.viewer?.refreshLabels?.();
    });
    this.on(this.el("marker-form"), "submit", (event) => {
      event.preventDefault();
      if (this.dialog("marker-dialog").dataset.mode !== "edit" || this.photoJobs) return;
      const route = this.state.routes.find((r) => r.id === this.editingRoute);
      if (route) return this.saveRoute(route);
      if (!this.markerPoint) return;
      const label = this.input("marker-label").value.trim();
      if (!label) return;
      const existing = this.state.markers.find(
        (m) => m.id === this.editingMarker,
      );
      const created = existing?.created ?? Date.now();
      const marker: MapMarker = {
        id: existing?.id ?? crypto.randomUUID(),
        point: this.markerPoint,
        label,
        description: this.el<HTMLTextAreaElement>("marker-description").value.trim(),
        ...(this.formPhotos.length ? { photos: [...this.formPhotos] } : {}),
        kind: this.markerKind(),
        ...(this.markerKind() === "flooded" && this.formWater ? { water: this.formWater } : {}),
        ...(this.markerKind() === "unstable" ? { danger: this.formDanger } : {}),
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
        this.newMarkerKind = marker.kind;
      } else if (!unchanged)
        this.state.markers = this.state.markers.map((m) => m === existing ? marker : m);
      const returnToDetails = this.viewingMarker === marker.id && !this.moveAfterSave;
      if (!returnToDetails) this.dialog("marker-dialog").close();
      if (!unchanged) this.changed();
      if (this.moveAfterSave) {
        this.moveMarker(marker);
        return;
      }
      if (returnToDetails) this.showDetails(marker);
      else this.mode("browse");
      this.toast(!existing ? t("{name} saved", { name: label }) : unchanged ? t("{name} unchanged", { name: label }) : t("{name} updated", { name: label }),
        unchanged ? "quiet" : "done");
    });
    // Move or Edit points from the card keeps what was typed, then lifts the
    // pin or the route's points.
    for (const id of ["marker-move", "route-points"])
      this.click(id, () => {
        this.moveAfterSave = true;
        this.el<HTMLFormElement>("marker-form").requestSubmit();
        this.moveAfterSave = false;
      });
    this.click("name-cancel", () => this.dialog("name-dialog").close());
    this.on(this.el("name-form"), "submit", (event) => {
      event.preventDefault();
      const name = this.input("name-input").value.trim();
      if (!name) return;
      this.dialog("name-dialog").close();
      this.nameAction?.(name);
      this.nameAction = undefined;
    });
  }
  private setRotationMode(mode: RotationMode) {
    this.state.rotationMode = mode;
    track("rotation_changed", { mode });
    this.changed();
    if (mode === "compass") void this.startCompass(true);
    else this.stopCompass();
  }
  private setNorth(degrees: number) {
    this.state.northOffset = wrapNorth(degrees);
    this.persistence.changed();
    this.orient();
    this.renderRotation();
  }
  /** Asks for the compass when `ask` (from a tap), then follows it. */
  private async startCompass(ask: boolean) {
    this.stopCompass();
    const run = this.compassRun;
    this.compass = "waiting";
    this.renderRotation();
    const allowed = !ask || (await allowCompass());
    if (run !== this.compassRun) return;
    if (!allowed) {
      this.compass = "blocked";
      this.renderRotation();
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
      if (this.compass === "on") return;
      this.compass = "on";
      this.renderRotation();
    });
    const timer = setTimeout(() => {
      if (this.compass !== "waiting") return;
      this.compass = "missing";
      this.renderRotation();
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
  private renderRotation() {
    const mode = this.state.rotationMode,
      { icon, label } = rotationModes[mode];
    const chip = this.el("open-rotation");
    chip.innerHTML = icon;
    chip.setAttribute("aria-label", t("Rotation: {mode}", { mode: label }));
    chip.title = t("Rotation: {mode}", { mode: label });
    if (this.openSheet === "rotation") {
      this.el("sheet-title-icon").innerHTML = icon;
      // Compass mode turns the map with the phone, so a reset would not hold.
      this.el("reset-rotation").hidden = mode === "compass";
    }
    for (const each of manualModes) this.input(`rotation-${each}`).checked = each === mode;
    const follow = preference("compass-follow"), speed = preference("compass-speed");
    for (const each of follows) this.input(`compass-follow-${each}`).checked = mode === "compass" && each === follow;
    for (const each of speeds) this.input(`compass-speed-${each}`).checked = each === speed;
    const compassHelp: Partial<Record<CompassStatus, string>> = {
      waiting: t("Looking for the compass…"),
      missing: compassNeedsPermission()
        ? t("Tap your compass choice again to turn it on.")
        : t("No compass found. Compass mode needs a phone or tablet."),
      blocked: t("Compass access is off. Allow motion and orientation access for this site, then tap your choice again."),
    };
    // Each row explains its mode, so the line below the list only reports the compass.
    const help = this.el("rotation-help");
    help.textContent = (mode === "compass" && compassHelp[this.compass]) || "";
    help.hidden = !help.textContent;
    this.el("north-field").hidden = mode !== "compass";
    this.el("speed-field").hidden = mode !== "compass" || follow !== "auto";
    this.el("speed-help").innerHTML = speed === "live"
      ? `${t("Instant.")}<span class="warning">${t("Very hungry for battery.")}</span>`
      : t("Turns after {seconds} s in the same direction.", { seconds: (speedDelays[speed] / 1000).toLocaleString(locale) });
    const wheel = this.el("north-offset"), north = this.state.northOffset;
    wheel.setAttribute("aria-valuenow", String(north));
    wheel.setAttribute("aria-valuetext", t("{degrees}° clockwise", { degrees: north }));
    const row = north - NORTH_MIN;
    wheel.querySelector(".selected")?.classList.remove("selected");
    wheel.children[row]?.classList.add("selected");
    // Only a wheel showing another degree moves; a scrolling one already matches.
    if (Math.round(wheel.scrollTop / NORTH_ROW_PX) !== row) wheel.scrollTop = row * NORTH_ROW_PX;
  }
  private renderDark() {
    this.el("dark-status").textContent = this.state.inverted
      ? darkMessages[this.darkKind]
      : t("Off: original colors");
  }
  private renderTool() {
    this.viewer?.refreshLabels?.();
    this.root.dataset.tool = this.tool;
    const editing = this.tool !== "browse",
      sheetOpen = !!this.openSheet;
    // One task at a time: its card takes the pill's place until it's over.
    for (const sheet of sheets)
      this.el<HTMLButtonElement>(`open-${sheet}`).disabled = editing;
    const measuring = this.measuring();
    const measure = this.el<HTMLButtonElement>("open-measure");
    measure.disabled = editing && !measuring;
    measure.setAttribute("aria-pressed", String(measuring));
    this.input("map-search").disabled = editing;
    this.el("dock").hidden = editing;
    this.el("tool-bar").hidden = !editing || sheetOpen;
    const route = this.route();
    const count = route?.points.length ?? 0;
    const discarding = this.confirming === "cancel-route";
    const scale = this.state.metresPerPixel;
    const tape = measuring ? this.tape() : [];
    const metres = this.tool === "measure" && scale && tape.length > 1 ? pathLength(tape) * scale : undefined;
    const routeMetres = scale && count > 1 ? pathLength(route!.points) * scale : undefined;
    const texts: Record<Tool, [string, string, string]> = {
      browse: ["", "", ""],
      move: [
        icons.move,
        this.movingPlace()?.label ?? t("Place"),
        t("Drag the pin, or tap where it goes"),
      ],
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
        metres !== undefined ? t("~{time} on foot · Tap to add, drag to adjust", { time: formatWalk(metres) })
          : tape.length ? t("Tap the next point") : t("Tap where to start measuring"),
      ],
      scale: [
        icons.scale,
        t("Set scale"),
        tape.length > 1 ? t("Drag the ends to adjust, then tap Next")
          : tape.length ? t("Tap the other end") : t("Tap one end of the scale bar or of a known length"),
      ],
    };
    const [icon, title, message] = texts[this.tool];
    this.el("tool-icon").innerHTML = icon;
    this.el("tool-title").textContent = title;
    this.el("tool-message").textContent = message;
    // Measuring, the big number is the total; the hint below it says how long it takes.
    const total = this.el("tool-total");
    total.textContent = metres !== undefined ? formatDistance(metres) : "";
    total.hidden = metres === undefined;
    const rename = this.el("tool-rename");
    rename.hidden = this.tool !== "route" && this.tool !== "measure";
    const renameLabel = this.tool === "measure" ? t("Change scale") : t("Rename route");
    rename.setAttribute("aria-label", renameLabel);
    rename.title = renameLabel;
    const cancel = this.el("tool-cancel");
    cancel.classList.toggle("armed", discarding);
    const cancelLabel = discarding ? t("Discard?") : t("Cancel");
    cancel.setAttribute("aria-label", cancelLabel);
    cancel.title = cancelLabel;
    this.el("tool-actions").hidden = this.tool === "browse" || this.tool === "marker" || this.tool === "trail";
    this.el("route-undo").hidden = this.tool !== "route" && !measuring;
    this.el<HTMLButtonElement>("route-undo").disabled = measuring
      ? !tape.length && !this.measureHistory.length
      : !count && !this.routeHistory.length;
    // Measuring has nothing to save, so × is how it ends; the scale goes on to its length.
    const done = this.el<HTMLButtonElement>("tool-done");
    done.hidden = this.tool === "measure";
    done.innerHTML = this.tool === "scale" ? icons.next : icons.check;
    done.append(Object.assign(this.root.ownerDocument.createElement("span"),
      { textContent: this.tool === "scale" ? t("Next") : t("Done") }));
    done.disabled = (this.tool === "route" || this.tool === "scale") && (this.tool === "route" ? count : tape.length) < 2;
  }
  // Saved rows open a place's or route's details; ⋯ exposes actions.
  private row(
    container: HTMLElement,
    options: {
      key: string;
      label: string;
      description?: string;
      /** Shown before the photo count, e.g. a route's points. */
      meta?: string;
      photos?: string[];
      icon: string;
      jump: () => void;
      actions: {
        label: string;
        icon: string;
        action: () => void;
        danger?: boolean;
      }[];
    },
  ) {
    const row = document.createElement("li");
    row.className = "navigation-row";
    row.dataset.row = options.key;
    const main = document.createElement("div");
    main.className = "row-main";
    const button = document.createElement("button");
    button.className = "navigation-jump";
    const icon = document.createElement("i"),
      text = document.createElement("span"),
      title = document.createElement("strong");
    icon.className = "row-icon";
    icon.innerHTML = options.icon;
    text.className = "row-text";
    title.textContent = options.label;
    title.title = options.label;
    text.append(title);
    // One line under the name: a route's points, the photo count, then the description.
    const photoCount = options.photos?.length ?? 0;
    if (options.meta || photoCount || options.description) {
      const detail = document.createElement("small");
      detail.className = "row-detail";
      if (options.meta)
        detail.append(options.meta + (photoCount || options.description ? " · " : ""));
      if (photoCount) {
        const photos = document.createElement("span");
        photos.className = "row-photos";
        photos.innerHTML = icons.photos;
        photos.append(String(photoCount));
        photos.setAttribute("role", "img");
        photos.setAttribute("aria-label", plural(photoCount, "photo"));
        detail.append(photos, options.description ? " · " : "");
      }
      if (options.description) detail.append(options.description);
      text.append(detail);
    }
    button.append(icon, text);
    button.addEventListener("click", () => {
      options.jump();
      // Arriving, the item pulses so the eye finds it at once.
      this.viewer?.pulse?.(options.key);
      this.sheet(undefined);
    });
    const toggle = document.createElement("button");
    toggle.className = "row-more";
    toggle.innerHTML = icons.more;
    toggle.setAttribute("aria-label", t("Actions for {name}", { name: options.label }));
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.addEventListener("click", () => {
      this.closeRowMenu();
      this.rowMenu = options.key;
      const sheet = this.rowSheet = showActionSheet(this.root, {
        title: options.label,
        detail: options.meta,
        icon: options.icon,
        actions: options.actions.map((extra) => extra.danger
          ? { ...extra, label: this.deleteLabel(options.key), stay: true }
          : extra),
      });
      sheet.addEventListener("close", () => {
        if (this.rowSheet === sheet) this.closeRowMenu();
      });
    });
    main.append(button, toggle);
    row.append(main);
    container.append(row);
  }
  // A section's menu: an order, picked once, and for places the kinds to show, several at a time.
  private savedMenu(id: "routes-order" | "places-order") {
    const anchor = this.el(id);
    const menu = document.createElement("div");
    menu.id = "saved-section-menu";
    menu.className = "row-popover";
    menu.dataset.width = "256";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", anchor.getAttribute("aria-label")!);
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", menu.id);
    const group = (label: string) => {
      const heading = document.createElement("div");
      heading.className = "popover-label";
      heading.textContent = label;
      menu.append(heading);
    };
    const item = (role: string, label: string, icon: string, checked: boolean, action: () => void) => {
      const button = document.createElement("button");
      button.className = "popover-item";
      button.setAttribute("role", role);
      button.setAttribute("aria-checked", String(checked));
      const text = document.createElement("span");
      text.textContent = label;
      button.innerHTML = icon;
      button.append(text);
      button.insertAdjacentHTML("beforeend", icons.check);
      button.lastElementChild!.classList.add("popover-check");
      button.addEventListener("click", action);
      menu.append(button);
    };
    const pick = () => {
      this.closeRowMenu();
      this.render();
    };
    group(t("Order"));
    if (id === "routes-order")
      for (const [order, label] of Object.entries(routeOrders) as [keyof typeof routeOrders, string][])
        item("menuitemradio", label, icons[order], order === this.routeOrder, () => {
          setPreference("route-order", this.routeOrder = order);
          pick();
        });
    else {
      for (const [order, label] of Object.entries(placeOrders) as [keyof typeof placeOrders, string][])
        item("menuitemradio", label, icons[order], order === this.placeOrder, () => {
          setPreference("place-order", this.placeOrder = order);
          pick();
        });
      group(t("Type"));
      item("menuitemcheckbox", t("All types"), icons.pin, !this.placeKinds.size, () => {
        this.placeKinds.clear();
        this.render();
      });
      for (const kind of this.savedKinds())
        item("menuitemcheckbox", markerKinds[kind].label, placeIcon(kind), this.placeKinds.has(kind), () => {
          if (!this.placeKinds.delete(kind)) this.placeKinds.add(kind);
          this.render();
        });
    }
    this.rowPopover = menu;
    this.rowMenuAnchor = anchor;
    this.root.append(menu);
  }
  /** Each kind of place saved here, in the picker's order. */
  private savedKinds() {
    const kinds = new Set(this.state.markers.map((marker) => marker.kind));
    return (Object.keys(markerKinds) as MapMarker["kind"][]).filter((kind) => kinds.has(kind));
  }
  // Dismiss without rebuilding rows: pointerdown must not remove the pending click target.
  private closeRowMenu() {
    if (!this.rowMenu && !this.rowPopover) return;
    const anchor = this.rowMenuAnchor, sheet = this.rowSheet;
    this.rowPopover?.remove();
    this.rowSheet = undefined;
    sheet?.close();
    anchor?.setAttribute("aria-expanded", "false");
    anchor?.removeAttribute("aria-controls");
    this.rowMenu = undefined;
    this.rowMenuAnchor = undefined;
    this.rowPopover = undefined;
    if (this.confirming && this.confirming !== "cancel-route") {
      clearTimeout(this.confirmTimer);
      this.confirming = undefined;
    }
  }
  private positionRowMenu() {
    const menu = this.rowPopover;
    const anchor = this.rowMenuAnchor;
    if (!menu || !anchor) return;
    const bounds = this.el("sheet").getBoundingClientRect();
    const origin = this.root.getBoundingClientRect();
    const width = Number(menu.dataset.width) || 216;
    menu.style.width = `${Math.max(0, Math.min(width, bounds.width - 16))}px`;
    const position = popoverPosition(anchor.getBoundingClientRect(), bounds, {
      width,
      height: (menu.scrollHeight || 0) + 2,
    });
    menu.style.left = `${position.left - origin.left}px`;
    menu.style.top = `${position.top - origin.top}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
  }
  // Two taps to delete: the first arms the button for a few seconds.
  private confirmDelete(key: string, action: () => void) {
    // Keep the sheet and scrolled list in place while arming or expiring Delete.
    const updateLabel = () => {
      if (this.rowMenu !== key) return;
      const button = this.rowSheet?.querySelector(".danger");
      button?.classList.toggle("armed", this.confirming === key);
      if (button) button.querySelector("span")!.textContent = this.deleteLabel(key);
    };
    return () => {
      if (this.confirming === key) {
        clearTimeout(this.confirmTimer);
        this.confirming = undefined;
        this.closeRowMenu();
        action();
        return;
      }
      this.confirming = key;
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => {
        this.confirming = undefined;
        updateLabel();
      }, 3000);
      updateLabel();
    };
  }
  private armCardDelete(armed?: CardDelete) {
    this.cardDeleteArmed = armed;
    clearTimeout(this.cardDeleteTimer);
    if (armed) this.cardDeleteTimer = setTimeout(() => this.armCardDelete(), 3000);
    // The card's buttons share a row, so the armed label stays short and the
    // button fills red instead.
    for (const id of cardDeletes) {
      const button = this.el(id);
      button.classList.toggle("armed", id === armed);
      button.querySelector("span")!.textContent = id === armed ? t("Tap again") : t("Delete");
    }
  }
  private deleteLabel(key: string) {
    return this.confirming === key ? t("Tap again to delete") : t("Delete");
  }
  /** Before a trip: what it is and how to start. During one: how far it has come. */
  private renderTrail() {
    const trail = this.state.trail, start = trail[0], last = trail.at(-1);
    // The chip carries a red dot, like the one on the map, while a trip is under way.
    this.el("open-trail").classList.toggle("on-trip", !!start);
    this.el("trip-help").hidden = this.el("trip-start").hidden = !!start;
    this.el("trip-card").hidden = this.el("trip-back").hidden = this.el("trip-end").hidden = !start;
    this.el("trip-hint").textContent = start
      ? t("Long-press the map, then drag down to mark where you are, or up-right to go back to your last mark.")
      : t("You can also long-press the map and drag down.");
    if (!start || !last) return;
    const now = Date.now();
    const started = dayValue(start.time) === dayValue(now) ? clock(start.time) : logDate(start.time);
    this.el("trip-summary").textContent = t("Started {time} · {points}", { time: started, points: plural(trail.length, "point") });
    const scale = this.state.metresPerPixel;
    const marked = t("Last marked {when}", { when: timeAgo(last.time, now) });
    this.el("trip-last").textContent = scale && trail.length > 1
      ? `${formatDistance(pathLength(trail) * scale)} · ${marked}` : marked;
  }
  private render() {
    this.renderTrail();
    this.renderRotation();
    this.input("dark-map").checked = this.state.inverted;
    for (const level of BRIGHTNESS_LEVELS)
      this.input(`brightness-${brightnessPercent(level)}`).checked = this.state.dimming === level;
    this.renderDark();
    const counts = {
      routes: this.state.routes.length,
      places: this.state.markers.length,
    };
    for (const layer of layerNames) {
      this.input(`layer-${layer}`).checked = this.state.layers[layer];
      if (layer !== "labels")
        this.el(`layer-${layer}-count`).textContent = String(counts[layer]);
    }
    this.el<HTMLButtonElement>("spotlight").disabled = !(counts.routes + counts.places);
    // Fine rotation only appears once twisting is unlocked.
    this.rowPopover?.remove();
    this.rowPopover = undefined;
    this.rowMenuAnchor = undefined;
    const markers = this.el("marker-list"),
      routes = this.el("route-list"),
      trips = this.el("trip-list");
    // Kinds no longer saved here drop out, so the filter can't hide every place,
    // and with its menu gone below two places, the filter goes too.
    const kinds = this.savedKinds();
    for (const kind of this.placeKinds)
      if (!kinds.includes(kind) || counts.places < 2) this.placeKinds.delete(kind);
    const placeList = orderPlaces(this.placeKinds.size
      ? this.state.markers.filter((marker) => this.placeKinds.has(marker.kind)) : this.state.markers, this.placeOrder);
    const routeList = orderRoutes(this.state.routes, this.routeOrder);
    // Ordering needs two items.
    for (const [id, count] of [["routes-order", counts.routes], ["places-order", counts.places]] as const) {
      const button = this.el(id);
      button.setAttribute("aria-expanded", "false");
      button.hidden = count < 2;
      if (button.hidden && this.rowMenu === id) this.rowMenu = undefined;
    }
    this.el("places-order").classList.toggle("active", this.placeKinds.size > 0);
    this.el("saved-routes-count").textContent = String(counts.routes);
    this.el("saved-places-count").textContent = this.placeKinds.size
      ? `${placeList.length}/${counts.places}` : String(counts.places);
    this.el("trip-history-count").textContent = String(this.state.trips.length);
    // Rows are built only while their panel shows; opening it builds them.
    const lists = this.openSheet === "saved" ? [markers, routes] : this.openSheet === "trail" ? [trips] : [];
    for (const list of lists) list.replaceChildren();
    if (this.openSheet === "saved") for (const marker of placeList) {
      this.row(markers, {
        key: marker.id,
        label: marker.label,
        description: marker.description,
        photos: marker.photos,
        icon: placeIcon(marker.kind, marker),
        jump: () => this.showDetails(marker),
        actions: [
          {
            label: t("Edit"),
            icon: icons.edit,
            action: () => this.editMarker(marker),
          },
          {
            label: t("Move"),
            icon: icons.move,
            action: () => this.moveMarker(marker),
          },
          ...(this.onShare ? [{ label: t("Share"), icon: icons.share,
            action: () => this.onShare?.({ kind: "marker", id: marker.id }) }] : []),
          {
            label: this.deleteLabel(marker.id),
            icon: icons.trash,
            danger: true,
            action: this.confirmDelete(marker.id, () => {
              const index = this.state.markers.indexOf(marker);
              this.state.markers = this.state.markers.filter(
                (m) => m.id !== marker.id,
              );
              this.changed();
              this.deleted(marker.label, () => this.state.markers.splice(index, 0, marker));
            }),
          },
        ],
      });
    }
    if (this.openSheet === "saved") for (const route of routeList) {
      this.row(routes, {
        key: route.id,
        label: route.name,
        description: route.description,
        meta: `${travelSummary(route.points, this.state.metresPerPixel) ?? plural(route.points.length, "point")}${route.draft ? " · unfinished" : ""}`,
        photos: route.photos,
        icon: this.routeIcon(route),
        jump: () => this.showDetails(route),
        actions: [
          {
            label: t("Edit"),
            icon: icons.edit,
            action: () => this.editRouteDetails(route),
          },
          {
            label: route.draft ? t("Continue") : t("Edit points"),
            icon: icons.route,
            action: () => this.editRoute(route),
          },
          ...(this.onShare && !route.draft ? [{ label: t("Share"), icon: icons.share,
            action: () => this.onShare?.({ kind: "route", id: route.id }) }] : []),
          {
            label: this.deleteLabel(route.id),
            icon: icons.trash,
            danger: true,
            action: this.confirmDelete(route.id, () => {
              this.deleteRoute(route);
            }),
          },
        ],
      });
    }
    // Newest first: the trip just ended is the one most likely looked for.
    if (this.openSheet === "trail") for (const trip of [...this.state.trips].reverse()) {
      const scale = this.state.metresPerPixel;
      const minutes = Math.round((trip.ended - trip.points[0]!.time) / 60_000);
      this.row(trips, {
        key: trip.id,
        label: this.tripName(trip),
        meta: [clock(trip.points[0]!.time),
          scale ? formatDistance(pathLength(trip.points) * scale) : plural(trip.points.length, "point"),
          formatMinutes(minutes)].join(" · "),
        icon: icons.trail,
        jump: () => this.showTrip(trip),
        actions: [{
          label: this.deleteLabel(trip.id),
          icon: icons.trash,
          danger: true,
          action: this.confirmDelete(trip.id, () => {
            const index = this.state.trips.indexOf(trip);
            this.state.trips = this.state.trips.filter((other) => other.id !== trip.id);
            if (this.viewingTrip === trip.id) this.dialog("trip-dialog").close();
            this.changed();
            this.deleted(this.tripName(trip), () => this.state.trips.splice(index, 0, trip));
          }),
        }],
      });
    }
    // Empty lists keep a short status message.
    for (const [container, empty] of [
      [markers, t("No places yet.")],
      [routes, t("No routes yet.")],
      [trips, t("No trips yet.")],
    ] as const)
      if (lists.includes(container) && !container.childElementCount) {
        const item = document.createElement("li");
        item.className = "empty-list";
        item.textContent = empty;
        container.append(item);
      }
    if (this.rowMenu === "routes-order" || this.rowMenu === "places-order") this.savedMenu(this.rowMenu);
    // Measure only after all rows are back in the list and the panel has its final height.
    this.positionRowMenu();
    this.renderTool();
  }
  refreshMetadata() {
    this.render();
  }
  // Keep detection status available to assistive technology while indexing;
  // a running scan also passes its progress, from 0 to 1, for the top toast.
  updateOcr(index: OcrIndex | undefined, message = "", progress?: number) {
    const sameIndex = this.ocr === index;
    this.ocr = index;
    this.ocrMessage = message;
    const toast = this.el("ocr-progress");
    toast.hidden = progress === undefined;
    if (progress !== undefined) {
      const percent = Math.floor(progress * 100);
      this.el("ocr-percent").textContent = `${percent}%`;
      toast.setAttribute("aria-valuenow", String(percent));
    }
    this.renderSearch(sameIndex || !!this.searchTimer);
  }
  // Typing coalesces into one search; clearing and result navigation apply immediately.
  private queueSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    const query = this.input("map-search").value;
    if (!normalizeText(query)) {
      this.renderSearch();
      return;
    }
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
      this.searchQuery = this.input("map-search").value;
      this.searchMatches = searchMap(this.ocr, this.state.markers, this.searchQuery);
      this.searchPosition = -1;
      this.viewer?.setSearch?.(this.searchMatches,
        !!normalizeText(this.searchQuery) && (!!this.ocr || !!this.searchMatches.length));
    }
    const active = !!normalizeText(this.searchQuery);
    const count = this.searchMatches.length;
    const stepping = count > 1 && this.searchPosition >= 0;
    const message = active
      ? stepping ? t("Match {current} of {total}", { current: this.searchPosition + 1, total: count })
        : count ? plural(count, "match")
        : this.ocr ? t("No matching text or saved places found.") : t("No matching saved places yet.")
      : t("Search map text and saved places. Drag and zoom to explore.");
    const progress = this.ocrMessage || (!this.ocr ? t("Text detection is not ready. Open the map’s Advanced settings to retry.") : "");
    this.el("search-status").textContent = progress ? `${message} · ${progress}` : message;
    // The count doubles as Next, so a touch screen can step through matches
    // once Enter has put the keyboard away; it then shows where you are.
    const badge = this.el<HTMLButtonElement>("search-count");
    // A bare grey 0 is easy to miss; a miss says so in words.
    badge.textContent = stepping ? `${this.searchPosition + 1} / ${count}`
      : count ? plural(count, "match") : t("No matches");
    badge.insertAdjacentHTML("beforeend", icons.next);
    badge.hidden = !active;
    badge.disabled = !count;
    badge.classList.toggle("empty", !count);
    badge.setAttribute("aria-label", stepping
      ? t("Match {current} of {total}. Next match", { current: this.searchPosition + 1, total: count })
      : plural(count, "result"));
    this.viewer?.refreshLabels?.();
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
    this.input("map-search").blur();
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
    this.sheet(undefined);
    clearTimeout(this.searchTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.spotlightTimer);
    clearTimeout(this.cardDeleteTimer);
    clearTimeout(this.confirmTimer);
    clearTimeout(this.discardTimer);
    this.stopCompass();
    this.el("map-stage").classList.remove("spotlight");
    this.showToast(false);
    const saved = this.flush();
    this.controller.abort();
    this.dialog("marker-dialog").close();
    this.dialog("name-dialog").close();
    return saved;
  }
}
