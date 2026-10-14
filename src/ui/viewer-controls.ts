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
  lastSeen,
  layerNames,
  markerKinds,
  routeColor,
  wrapNorth,
  NORTH_MIN,
  type NavigationState,
  type Tool,
  type MapMarker,
  type PlaceLogEntry,
  type PlannedRoute,
  type RotationMode,
  type WaterLevel,
  waterLevels,
} from "../viewer/navigation";
import { allowCompass, compassNeedsPermission, watchCompass } from "../viewer/compass";
import { icons } from "./icons";
import { logDate, nextName, plural, seenAgo } from "./format";
import { t } from "../i18n";
import { placeIcon } from "./place-icon";
import { popoverPosition } from "./popover-position";
import {
  normalizeText,
  ocrLabelAt,
  type OcrIndex,
} from "../ocr/index";
import { matchPoints, searchMap, type MapSearchMatch } from "../viewer/map-search";
const sheets = ["display", "rotation", "saved", "add"] as const;
/** A day as a date input holds it, in local time. */
const dayValue = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
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
const rotationModes: Record<RotationMode, { icon: string; label: string; help: string }> = {
  free: { icon: icons.freeRotation, label: t("Normal"), help: t("Twist with two fingers to turn the map.") },
  compass: { icon: icons.compass, label: t("Auto"), help: t("The map turns with your phone, so it lines up with the world around you.") },
  locked: { icon: icons.rotationLock, label: t("Locked"), help: t("The map keeps its current angle.") },
};
/** Auto mode's compass: off, starting, turning the map, or not reaching it. */
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
/** Smaller compass changes are sensor noise; following them redraws the map nonstop. */
const COMPASS_STEP_DEGREES = 2;
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
    Partial<Pick<Viewer, "orient" | "straighten" | "setSearch" | "refreshLabels" | "previewPlace" | "pulse" | "reveal" | "showing" | "cover" | "select">>;
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
  private cardDeleteArmed = false;
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
  private openSheet?: Sheet;
  private darkKind: DarkMode["kind"] = "inverted";
  /** New places start as the kind last saved, for runs of entrances or notes. */
  private newMarkerKind: MapMarker["kind"] = "landmark";
  /** Photos in the place form, saved with the place on Save. */
  private formPhotos: string[] = [];
  /** The place whose "Seen today?" got a No while its card stays open. */
  private seenAskDismissed?: string;
  /** The log in the place form; entries removed here are deleted on Save. */
  private formLog: PlaceLogEntry[] = [];
  /** The water level picked in the form; kept only if the place is saved as flooded. */
  private formWater?: WaterLevel;
  /** Bumped per form so a photo still being prepared can't land on another place. */
  private formVersion = 0;
  private photoJobs = 0;
  /** Object URLs for the open card, revoked when it closes. */
  private photoURLs = new Map<string, Promise<string | undefined>>();
  private photoViewer?: PhotoViewer;
  private compass: CompassStatus = "off";
  /** Where the top of the phone points, in degrees from north. */
  private heading?: number;
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
    // Browsers that ask first only answer a tap, so this may wait for one.
    if (state.rotationMode === "compass") void this.startCompass(false);
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
        this.persistence.changed();
      },
      onTap: (point) => this.onTap(point),
      onMarker: (marker) => this.showDetails(marker),
      onRoute: (route) => this.showDetails(route),
      onEmptyTap: () => this.closePlaceDetails(),
      // A result's label flies to that result, like stepping to it.
      onSearchResult: (index) => this.showMatch(index),
      // Long-press drops a place without going through Add.
      onLongPress: (point) => {
        if (this.tool !== "browse") return;
        navigator.vibrate?.(12);
        this.openMarker(t("New place"), point);
      },
      onDragStart: () => {
        const route = this.tool === "route" ? this.route() : undefined;
        this.dragBefore = route && copyPoints(route.points);
      },
      onDrop: (moved) => {
        if (moved && this.dragBefore) this.routeHistory.push(this.dragBefore);
        this.dragBefore = undefined;
        if (moved) this.changed();
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
    this.renderTool();
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
    this.tool = tool;
    this.viewer?.setTool(
      tool,
      tool === "move" ? this.movingMarker : this.activeRoute,
    );
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
  /** Paints the picker and card for the chosen level; the picker shows only for flooded. */
  private setFormWater(water?: WaterLevel) {
    this.formWater = water;
    const kind = this.markerKind();
    this.el("marker-water").hidden = kind !== "flooded";
    for (const step of this.root.querySelectorAll<HTMLElement>(".water-step"))
      step.setAttribute("aria-pressed", String(Number(step.dataset.water) === water));
    this.paintPlaceCard(kind, water);
    this.el("marker-kind-current").innerHTML =
      `${placeIcon(kind, water)}<span>${(markerKinds[kind] ?? markerKinds.landmark).label}</span>`;
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
    this.el("marker-move").hidden = true;
    this.el("route-points").hidden = !route;
    this.input("marker-label").value = fields.name;
    this.el<HTMLTextAreaElement>("marker-description").value = fields.description ?? "";
    this.armCardDelete(false);
    this.formVersion++;
    this.formPhotos = [...(fields.photos ?? [])];
    this.renderFormPhotos();
    this.formLog = [];
    this.renderFormLog();
    this.el("marker-seen-field").hidden = true;
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
    this.setFormWater(marker?.water);
    this.formLog = [...marker?.log ?? []];
    this.renderFormLog();
    const seen = this.input("marker-seen-date");
    seen.value = dayValue(marker ? lastSeen(marker) : Date.now());
    seen.max = dayValue(Date.now());
    this.el("marker-seen-field").hidden = false;
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
      this.markerKind(), this.formWater, this.input("marker-seen-date").value,
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
  /** Each entry as a dated line, newest first. */
  /** The journal as a timeline, each entry one line after its date; editing can remove entries. */
  private logItems(log: PlaceLogEntry[], remove?: (entry: PlaceLogEntry) => void) {
    const document = this.root.ownerDocument;
    return newestFirst(log).map((entry) => {
      const item = document.createElement("li");
      const date = document.createElement("time");
      date.dateTime = new Date(entry.date).toISOString();
      date.textContent = logDate(entry.date);
      const text = document.createElement("p");
      text.append(date, entry.text);
      item.append(text);
      if (remove) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "log-remove";
        button.innerHTML = icons.close;
        button.setAttribute("aria-label", t("Remove entry from {date}", { date: date.textContent }));
        button.title = t("Remove entry");
        this.on(button, "click", () => remove(entry));
        item.append(button);
      }
      return item;
    });
  }
  private renderFormLog() {
    this.el("marker-log-edit").replaceChildren(...this.logItems(this.formLog, (entry) => {
      this.formLog = this.formLog.filter((other) => other !== entry);
      this.renderFormLog();
    }));
    this.el("marker-log-field").hidden = !this.formLog.length;
  }
  /** When the place was last seen, under its title, and its journal under the description. */
  private renderPlaceLog(place?: MapMarker) {
    this.el("marker-detail-seen").hidden = !place;
    this.el("marker-add-entry").hidden = !place;
    this.el("marker-detail-log").hidden = !place?.log?.length;
    this.el("marker-seen-ask").hidden = true;
    if (!place) return;
    this.el("marker-detail-seen").textContent = seenAgo(lastSeen(place));
    // Asked until the place is confirmed today, or until No for this reading.
    this.el("marker-seen-ask").hidden = this.seenAskDismissed === place.id ||
      dayValue(lastSeen(place)) === dayValue(Date.now());
    this.el("marker-log-list").replaceChildren(...this.logItems(place.log ?? []));
  }
  private openLogEntry() {
    const today = dayValue(Date.now());
    const date = this.input("entry-date");
    date.value = date.max = today;
    this.el<HTMLTextAreaElement>("entry-text").value = "";
    this.el<HTMLButtonElement>("entry-add").disabled = true;
    this.armDiscard();
    showDialog(this.dialog("entry-dialog"));
    // The date is already today, so the note is all there is to type.
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
    // Moving a place: a tap puts it there, as an alternative to dragging.
    const moving = this.movingPlace();
    if (moving) {
      moving.point = point;
      this.changed();
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
  private paintPlaceCard(kind: MapMarker["kind"], water?: WaterLevel) {
    const { color } = markerKinds[kind] ?? markerKinds.landmark;
    this.paintCard(placeIcon(kind, water), color);
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
    if ("label" in item) this.paintPlaceCard(item.kind, item.water);
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
    const waterLine = this.el("marker-detail-water");
    waterLine.textContent = water ? t("Water level: {level}", { level: waterLevels[water] }) : "";
    waterLine.hidden = !water;
    this.renderPlaceLog(place);
    const details = this.el("marker-details");
    details.setAttribute("aria-label", place ? t("Place details") : t("Route details"));
    // With nothing to read, the card shrinks to its header.
    details.hidden = !item.description && !count && !water && !place?.log?.length;
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
  /** Closes the place or route being read; true if there was one. */
  private closePlaceDetails() {
    const card = this.dialog("marker-dialog");
    if (!card.hasAttribute("open") || this.cardModal) return false;
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
    for (const sheet of ["display", "rotation", "saved"] as const)
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
    for (const mode of Object.keys(rotationModes) as RotationMode[]) {
      const input = this.input(`rotation-${mode}`);
      this.on(input, "change", () => {
        if (input.checked) this.setRotationMode(mode);
      });
    }
    // Tapping Auto again retries a compass that needs permission or went missing.
    this.click("rotation-compass", () => {
      if (this.state.rotationMode === "compass" && (this.compass === "missing" || this.compass === "blocked"))
        void this.startCompass(true);
    });
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
      if (target?.closest?.(".row-popover, .row-more")) return;
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
    this.click("open-add", () =>
      this.sheet(this.openSheet === "add" ? undefined : "add"),
    );
    // The task card's X cancels: a route is dropped, a moved place goes back.
    this.click("tool-cancel", () => {
      if (this.tool === "route") this.cancelRoute();
      else if (this.tool === "move") this.finishMove(false);
      else this.mode("browse");
    });
    this.click("tool-rename", () => {
      const route = this.route();
      if (route)
        this.name(t("Rename route"), route.name, (name) => {
          route.name = name;
          this.changed();
        });
    });
    this.click("add-marker", () => this.mode("marker"));
    this.click("share-saved", () => this.onShare?.());
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
      this.tool === "move" ? this.finishMove(true) : this.finishRoute(),
    );
    this.click("route-undo", () => {
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
    this.click("marker-seen-yes", () => {
      const place = this.viewedItem();
      if (!place || !("label" in place)) return;
      place.lastSeen = place.seenAt = Date.now();
      this.changed();
      this.renderPlaceLog(place);
      this.toast(t("{name} seen today", { name: place.label }), "done");
    });
    this.click("marker-seen-no", () => {
      this.seenAskDismissed = this.viewingMarker;
      this.el("marker-seen-ask").hidden = true;
    });
    this.click("marker-add-entry", () => this.openLogEntry());
    this.on(this.el("marker-details"), "scroll", () => this.markMoreDetails());
    this.click("entry-cancel", () => {
      const typed = !!this.el<HTMLTextAreaElement>("entry-text").value.trim();
      if (this.confirmDiscard("entry-cancel", typed)) this.dialog("entry-dialog").close();
    });
    this.on(this.el("entry-text"), "input", () => {
      this.el<HTMLButtonElement>("entry-add").disabled = !this.el<HTMLTextAreaElement>("entry-text").value.trim();
    });
    this.on(this.el("entry-form"), "submit", (event) => {
      event.preventDefault();
      const place = this.viewedItem();
      const text = this.el<HTMLTextAreaElement>("entry-text").value.trim();
      const day = this.input("entry-date").value;
      if (!place || !("label" in place) || !text || !day) return;
      const time = dayTime(day);
      place.log = [...place.log ?? [], { id: crypto.randomUUID(), date: time, text }];
      if (time > lastSeen(place)) {
        place.lastSeen = time;
        place.seenAt = Date.now();
      }
      this.dialog("entry-dialog").close();
      this.changed();
      this.showDetails(place);
      this.toast(t("Journal entry added to {name}", { name: place.label }), "done");
    });
    for (const id of ["marker-dialog", "entry-dialog", "name-dialog"])
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
      if (!this.cardDeleteArmed) {
        this.armCardDelete(true);
        return;
      }
      this.armCardDelete(false);
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
        this.setFormWater(this.formWater);
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
    for (const step of this.root.querySelectorAll<HTMLElement>(".water-step"))
      this.on(step, "click", () => {
        const water = Number(step.dataset.water) as WaterLevel;
        this.setFormWater(water === this.formWater ? undefined : water);
      });
    this.click("photo-viewer-close", () => this.dialog("photo-viewer").close());
    this.on(this.dialog("marker-dialog"), "close", () => {
      if (this.reopeningCard) {
        this.reopeningCard = false;
        return;
      }
      this.dialog("photo-viewer").close();
      this.viewingMarker = this.viewingRoute = this.seenAskDismissed = undefined;
      this.viewer?.select?.();
      this.formVersion++;
      for (const url of this.photoURLs.values()) void url.then((url) => url && URL.revokeObjectURL(url));
      this.photoURLs.clear();
      this.viewer?.cover?.();
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
      // Last seen only changes when its day was changed here, and then to any day, even earlier.
      const seenDay = this.input("marker-seen-date").value;
      const seen = seenDay && seenDay !== dayValue(existing ? lastSeen(existing) : created)
        ? { lastSeen: dayTime(seenDay), seenAt: Date.now() }
        : { ...(existing?.lastSeen ? { lastSeen: existing.lastSeen } : {}), ...(existing?.seenAt ? { seenAt: existing.seenAt } : {}) };
      const marker: MapMarker = {
        id: existing?.id ?? crypto.randomUUID(),
        point: this.markerPoint,
        label,
        description: this.el<HTMLTextAreaElement>("marker-description").value.trim(),
        ...(this.formPhotos.length ? { photos: [...this.formPhotos] } : {}),
        kind: this.markerKind(),
        ...(this.markerKind() === "flooded" && this.formWater ? { water: this.formWater } : {}),
        created,
        ...seen,
        ...(this.formLog.length ? { log: [...this.formLog] } : {}),
      };
      const kept = new Set(this.formLog.map((entry) => entry.id));
      const removed = (existing?.log ?? []).filter((entry) => !kept.has(entry.id)).map((entry) => entry.id);
      if (existing?.deletedLog || removed.length) marker.deletedLog = [...existing?.deletedLog ?? [], ...removed];
      const unchanged = !!existing && existing.label === marker.label &&
        existing.description === marker.description && existing.kind === marker.kind &&
        existing.water === marker.water &&
        existing.lastSeen === marker.lastSeen && !removed.length &&
        (existing.photos ?? []).join() === (marker.photos ?? []).join() &&
        existing.point.x === marker.point.x && existing.point.y === marker.point.y;
      // An edit keeps the place where it was in the Saved list.
      if (!existing) {
        this.state.markers.push(marker);
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
    const stop = watchCompass((heading) => {
      if (this.heading === undefined ||
        Math.abs(((heading - this.heading + 540) % 360) - 180) >= COMPASS_STEP_DEGREES) {
        this.heading = heading;
        this.orient();
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
    };
  }
  private stopCompass() {
    this.compassRun++;
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.compass = "off";
    this.heading = undefined;
    this.viewer?.orient?.(undefined);
  }
  /** The map's north points where the phone says north is. */
  private orient() {
    if (this.heading !== undefined)
      this.viewer?.orient?.((-(this.heading + this.state.northOffset) * Math.PI) / 180);
  }
  private renderRotation() {
    const mode = this.state.rotationMode,
      { icon, label, help } = rotationModes[mode];
    const chip = this.el("open-rotation");
    chip.innerHTML = icon;
    chip.setAttribute("aria-label", t("Rotation: {mode}", { mode: label }));
    chip.title = t("Rotation: {mode}", { mode: label });
    if (this.openSheet === "rotation") {
      this.el("sheet-title-icon").innerHTML = icon;
      // Auto turns the map with the phone, so a reset would not hold.
      this.el("reset-rotation").hidden = mode === "compass";
    }
    for (const each of Object.keys(rotationModes))
      this.input(`rotation-${each}`).checked = each === mode;
    const compassHelp: Partial<Record<CompassStatus, string>> = {
      waiting: t("Looking for the compass…"),
      missing: compassNeedsPermission()
        ? t("Tap Auto to turn on the compass.")
        : t("No compass found. Auto needs a phone or tablet."),
      blocked: t("Compass access is off. Allow motion and orientation access for this site, then tap Auto."),
    };
    this.el("rotation-help").textContent =
      (mode === "compass" && compassHelp[this.compass]) || help;
    this.el("north-field").hidden = mode !== "compass";
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
  /** Backs out one level (sheet → tool → browse); false when already browsing. */
  escape() {
    if (this.modalOpen()) return false;
    if (this.closePlaceDetails()) return true;
    if (this.rowMenu) this.closeRowMenu();
    else if (this.openSheet) this.sheet(undefined);
    else if (this.tool === "route") this.finishRoute();
    else if (this.tool === "move") this.finishMove(true);
    else if (this.tool !== "browse") this.mode("browse");
    else return false;
    return true;
  }
  private renderTool() {
    this.viewer?.refreshLabels?.();
    this.root.dataset.tool = this.tool;
    const editing = this.tool !== "browse",
      sheetOpen = !!this.openSheet;
    // One task at a time: its card takes the pill's place until it's over.
    for (const sheet of sheets)
      this.el<HTMLButtonElement>(`open-${sheet}`).disabled = editing;
    this.input("map-search").disabled = editing;
    this.el("dock").hidden = editing;
    this.el("tool-bar").hidden = !editing || sheetOpen;
    const route = this.route();
    const count = route?.points.length ?? 0;
    const discarding = this.confirming === "cancel-route";
    const texts: Record<Tool, [string, string, string]> = {
      browse: ["", "", ""],
      move: [
        icons.move,
        this.movingPlace()?.label ?? t("Place"),
        t("Drag the pin, or tap where it goes"),
      ],
      marker: [icons.pin, t("New place"), t("Tap the map where it goes")],
      route: [
        icons.route,
        route?.name ?? t("Route"),
        discarding
          ? this.routeStart?.points.length
            ? t("Tap × again to undo your changes")
            : t("Tap × again to discard this route")
          // Done waits for a second point, so the hint asks for it.
          : count > 1 ? t("{points} · Tap to add, drag to adjust", { points: plural(count, "point") })
          : count ? t("1 point · Tap where it goes next") : t("Tap where the route starts"),
      ],
    };
    const [icon, title, message] = texts[this.tool];
    this.el("tool-icon").innerHTML = icon;
    this.el("tool-title").textContent = title;
    this.el("tool-message").textContent = message;
    this.el("tool-rename").hidden = this.tool !== "route";
    const cancel = this.el("tool-cancel");
    cancel.classList.toggle("armed", discarding);
    const cancelLabel = discarding ? t("Discard?") : t("Cancel");
    cancel.setAttribute("aria-label", cancelLabel);
    cancel.title = cancelLabel;
    this.el("tool-actions").hidden = this.tool !== "route" && this.tool !== "move";
    this.el("route-undo").hidden = this.tool !== "route";
    this.el<HTMLButtonElement>("route-undo").disabled =
      !count && !this.routeHistory.length;
    this.el<HTMLButtonElement>("tool-done").disabled =
      this.tool === "route" && count < 2;
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
    const open = this.rowMenu === options.key;
    const toggle = document.createElement("button");
    toggle.className = "row-more";
    toggle.innerHTML = icons.more;
    toggle.setAttribute("aria-label", t("Actions for {name}", { name: options.label }));
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.addEventListener("click", () => {
      const wasOpen = this.rowMenu === options.key;
      this.closeRowMenu();
      if (wasOpen) return;
      this.rowMenu = options.key;
      showMenu();
      this.positionRowMenu();
    });
    main.append(button, toggle);
    row.append(main);
    container.append(row);
    // Render outside the scrolling list so overflow cannot clip the actions.
    const showMenu = () => {
      const menu = document.createElement("div");
      menu.id = "saved-row-menu";
      this.rowPopover = menu;
      this.rowMenuAnchor = toggle;
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-controls", menu.id);
      menu.className = "row-popover";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", options.label);
      for (const extra of options.actions) {
        const action = document.createElement("button");
        action.className = extra.danger ? "popover-item danger" : "popover-item";
        action.setAttribute("role", "menuitem");
        const label = document.createElement("span");
        label.textContent = extra.danger
          ? this.deleteLabel(options.key)
          : extra.label;
        action.innerHTML = extra.icon;
        action.append(label);
        action.addEventListener("click", () => {
          if (!extra.danger) this.closeRowMenu();
          extra.action();
        });
        menu.append(action);
      }
      this.root.append(menu);
    };
    if (open) showMenu();
  }
  // Dismiss without rebuilding rows: pointerdown must not remove the pending click target.
  private closeRowMenu() {
    if (!this.rowMenu && !this.rowPopover) return;
    const anchor = this.rowMenuAnchor;
    this.rowPopover?.remove();
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
    menu.style.width = `${Math.max(0, Math.min(216, bounds.width - 16))}px`;
    const position = popoverPosition(anchor.getBoundingClientRect(), bounds, {
      width: 216,
      height: (menu.scrollHeight || 0) + 2,
    });
    menu.style.left = `${position.left - origin.left}px`;
    menu.style.top = `${position.top - origin.top}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
  }
  // Two taps to delete: the first arms the button for a few seconds.
  private confirmDelete(key: string, action: () => void) {
    // Keep the menu and scrolled list in place while arming or expiring Delete.
    const updateLabel = () => {
      if (this.rowMenu !== key) return;
      const label = this.rowPopover?.querySelector(".danger span");
      if (label) label.textContent = this.deleteLabel(key);
      this.positionRowMenu();
    };
    return () => {
      if (this.confirming === key) {
        clearTimeout(this.confirmTimer);
        this.confirming = undefined;
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
  private armCardDelete(armed: boolean) {
    this.cardDeleteArmed = armed;
    clearTimeout(this.cardDeleteTimer);
    if (armed) this.cardDeleteTimer = setTimeout(() => this.armCardDelete(false), 3000);
    // The card's buttons share a row, so the armed label stays short and the
    // button fills red instead.
    const button = this.el("marker-delete");
    button.classList.toggle("armed", armed);
    button.querySelector("span")!.textContent = armed ? t("Tap again") : t("Delete");
  }
  private deleteLabel(key: string) {
    return this.confirming === key ? t("Tap again to delete") : t("Delete");
  }
  private render() {
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
    this.el("saved-routes-count").textContent = String(counts.routes);
    this.el("saved-places-count").textContent = String(counts.places);
    this.el<HTMLButtonElement>("spotlight").disabled = !(counts.routes + counts.places);
    // Fine rotation only appears once twisting is unlocked.
    this.rowPopover?.remove();
    this.rowPopover = undefined;
    this.rowMenuAnchor = undefined;
    const markers = this.el("marker-list"),
      routes = this.el("route-list");
    markers.replaceChildren();
    routes.replaceChildren();
    for (const marker of this.state.markers) {
      this.row(markers, {
        key: marker.id,
        label: marker.label,
        description: marker.description,
        photos: marker.photos,
        icon: placeIcon(marker.kind, marker.water),
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
              this.rowMenu = undefined;
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
    for (const route of this.state.routes) {
      this.row(routes, {
        key: route.id,
        label: route.name,
        description: route.description,
        meta: `${plural(route.points.length, "point")}${route.draft ? " · unfinished" : ""}`,
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
              this.rowMenu = undefined;
              this.deleteRoute(route);
            }),
          },
        ],
      });
    }
    // Empty lists keep a short status message.
    for (const [container, empty] of [
      [markers, t("No places yet.")],
      [routes, t("No routes yet.")],
    ] as const)
      if (!container.childElementCount) {
        const item = document.createElement("li");
        item.className = "empty-list";
        item.textContent = empty;
        container.append(item);
      }
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
