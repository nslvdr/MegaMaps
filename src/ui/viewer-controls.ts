import { showDialog } from "./dialog";
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
  layerNames,
  markerKinds,
  routeColor,
  wrapNorth,
  NORTH_MIN,
  type NavigationState,
  type Tool,
  type MapMarker,
  type PlannedRoute,
  type RotationMode,
} from "../viewer/navigation";
import { allowCompass, compassNeedsPermission, watchCompass } from "../viewer/compass";
import { icons } from "./icons";
import { nextName, plural } from "./format";
import { placeIcon } from "./place-icon";
import { popoverPosition } from "./popover-position";
import {
  normalizeText,
  ocrLabelAt,
  type OcrIndex,
} from "../ocr/index";
import { searchMap, type MapSearchMatch } from "../viewer/map-search";
const sheets = ["display", "rotation", "saved", "add"] as const;
const copyPoints = (points: Point[]) => points.map((point) => ({ ...point }));
type Sheet = (typeof sheets)[number] | "search";
const SEARCH_DEBOUNCE_MS = 200;
const SPOTLIGHT_MS = 4500;
const rotationModes: Record<RotationMode, { icon: string; label: string; help: string }> = {
  free: { icon: icons.rotateRight, label: "Normal", help: "Twist with two fingers to turn the map." },
  compass: { icon: icons.compass, label: "Auto", help: "The map turns with your phone, so it lines up with the world around you." },
  locked: { icon: icons.rotationLock, label: "Locked", help: "The map keeps its current angle." },
};
/** Auto mode's compass: off, starting, turning the map, or not reaching it. */
type CompassStatus = "off" | "waiting" | "on" | "missing" | "blocked";
const COMPASS_WAIT_MS = 3000;
/** Height of one north wheel row, as in `.north-track span`. */
const NORTH_ROW_PX = 32;
const darkMessages: Record<DarkMode["kind"], string> = {
  inverted: "Colors inverted on pure black",
  deepened: "Background deepened to black",
  "already-dark": "Map is already dark",
};

// Owns map tools/dialogs and saves; the renderer only knows coordinates/appearance.
export class ViewerControls {
  private viewer?: Pick<
    Viewer,
    "setTool" | "updateNavigation" | "jumpTo" | "fitPoints"
  > &
    Partial<Pick<Viewer, "orient" | "setSearch" | "refreshLabels" | "previewPlace" | "pulse" | "reveal" | "showing" | "cover" | "select">>;
  private ocr?: OcrIndex;
  private ocrMessage = "Preparing text detection…";
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
      () => this.toast("Could not save. Free some device storage."),
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
      // Long-press drops a place without going through Add.
      onLongPress: (point) => {
        if (this.tool !== "browse") return;
        navigator.vibrate?.(12);
        this.openMarker("New place", point);
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
  private toast(message: string, undo?: () => void) {
    const toast = this.el("toast");
    toast.textContent = message;
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
    this.toast(`${label} deleted`, () => {
      restore();
      this.changed();
      this.toast(`${label} restored`);
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
    this.el("marker-form").hidden = false;
    this.el("marker-dialog-title").textContent = title;
    this.editingRoute = route?.id;
    // A route's look comes from its line, so only places pick an icon.
    this.el("marker-kinds").hidden = !!route;
    this.el("marker-move").hidden = true;
    this.el("route-points").hidden = !route;
    this.input("marker-label").value = fields.name;
    this.el<HTMLTextAreaElement>("marker-description").value = fields.description ?? "";
    this.armCardDelete(false);
    this.formVersion++;
    this.formPhotos = [...(fields.photos ?? [])];
    this.renderFormPhotos();
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
    this.paintPlaceCard(kind);
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
    list.replaceChildren(...this.formPhotos.map((id, index) => {
      const item = this.root.ownerDocument.createElement("li");
      item.append(this.root.ownerDocument.createElement("img"));
      const remove = this.root.ownerDocument.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.innerHTML = icons.close;
      remove.setAttribute("aria-label", `Remove photo ${index + 1}`);
      remove.title = "Remove photo";
      this.on(remove, "click", () => {
        this.formPhotos = this.formPhotos.filter((photo) => photo !== id);
        this.renderFormPhotos();
      });
      item.append(remove);
      return this.photoImage(id, `Photo ${index + 1} of ${count}`, item);
    }));
    this.el("marker-photos-field").hidden = !count;
    const busy = this.photoJobs > 0;
    this.el<HTMLButtonElement>("marker-add-photos").disabled = busy;
    this.el("marker-add-photos").querySelector("span")!.textContent = busy ? "Adding photos…" : "Add photos";
    this.el<HTMLButtonElement>("marker-save").disabled = busy;
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
      ? "This photo could not be added." : `${plural(failed, "photo")} could not be added.`);
  }
  private onTap(point: Point) {
    if (!insideImage(point, this.map)) return;
    if (this.tool === "marker") this.openMarker("New place", point);
    // Moving a place: a tap puts it there, as an alternative to dragging.
    const moving = this.movingPlace();
    if (moving) {
      moving.point = point;
      this.changed();
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
        this.toast(`${route.name} unchanged`);
      } else if (route.points.length >= 2) {
        route.draft = false;
        this.toast(`${route.name} saved · ${plural(route.points.length, "point")}`);
      } else {
        this.state.routes = this.state.routes.filter((r) => r.id !== route.id);
        if (route.points.length)
          this.toast("Route discarded: it needs at least 2 points");
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
        start.points.length ? `${route.name} unchanged` : "Route discarded",
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
          keep ? `${marker.label} moved` : `${marker.label} not moved`,
        );
        this.changed();
      }
    }
    this.mode("browse");
  }
  private editMarker(marker: MapMarker) {
    this.openMarker("Edit place", marker.point, marker);
    // Under the card's shade every pin looks alike; this one says it's the one.
    this.viewer?.pulse?.(marker.id);
  }
  private editRouteDetails(route: PlannedRoute) {
    const card = this.dialog("marker-dialog");
    this.editingMarker = undefined;
    this.markerPoint = undefined;
    this.openForm("Edit route", route, route);
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
  private paintPlaceCard(kind: MapMarker["kind"]) {
    this.paintCard(placeIcon(kind), (markerKinds[kind] ?? markerKinds.landmark).color);
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
    this.root.style.removeProperty("--place-pane-scroll");
    const place = "label" in item ? item : undefined;
    this.viewingMarker = place?.id;
    this.viewingRoute = place ? undefined : item.id;
    card.dataset.mode = "view";
    this.el("marker-form").hidden = true;
    const edit = this.el("marker-edit");
    edit.hidden = false;
    edit.title = place ? "Edit place" : "Edit route";
    edit.setAttribute("aria-label", edit.title);
    this.el("marker-dialog-title").textContent = "label" in item ? item.label : item.name;
    if ("label" in item) this.paintPlaceCard(item.kind);
    else this.paintCard(this.routeIcon(item), routeColor(this.state, item.id));
    const description = this.el("marker-detail-description");
    description.textContent = item.description ?? "";
    description.hidden = !item.description;
    const photos = this.el("marker-detail-photos"), count = item.photos?.length ?? 0;
    photos.replaceChildren(...(item.photos ?? []).map((id, index) => {
      const open = this.root.ownerDocument.createElement("button");
      open.type = "button";
      open.title = "View full screen";
      open.append(this.root.ownerDocument.createElement("img"));
      this.on(open, "click", () => this.showPhotos(item.photos!, index));
      return this.photoImage(id, `Photo ${index + 1} of ${count}`, open);
    }));
    photos.hidden = !count;
    photos.scrollLeft = 0;
    const details = this.el("marker-details");
    details.setAttribute("aria-label", place ? "Place details" : "Route details");
    // With nothing to read, the card shrinks to its header.
    details.hidden = !item.description && !count;
    details.scrollTop = 0;
    // Measured at its natural height, up to half the screen.
    details.dataset.expandable = "false";
    this.presentCard(false);
    const overflowing = details.querySelector<HTMLElement>(".place-detail-content")!.scrollHeight > details.clientHeight;
    details.dataset.expandable = String(overflowing);
    // The map stays full size behind the pane; the item centers above it.
    this.viewer?.cover?.(card.offsetTop);
    this.frame(item);
    this.viewer?.select?.(item.id);
    this.viewer?.pulse?.(item.id);
    this.viewer?.refreshLabels?.();
  }
  /** A place centers without zooming out; a route fits whole. */
  private frame(item: MapMarker | PlannedRoute, animated = true) {
    if ("label" in item) this.viewer?.jumpTo(item.point, 1, animated);
    else this.viewer?.fitPoints(item.points, animated);
  }
  private presentCard(modal: boolean) {
    const card = this.dialog("marker-dialog");
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
  /** The initial native scroll distance unfolds the pane before the notes scroll. */
  private markerExpansionRange() {
    const style = getComputedStyle(this.dialog("marker-dialog"));
    return Math.max(0, parseFloat(style.maxHeight) - parseFloat(style.minHeight));
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
    this.toast(unchanged ? `${name} unchanged` : `${name} updated`);
  }
  private spotlight() {
    const stage = this.el("map-stage");
    const count = this.state.routes.length + this.state.markers.length;
    this.sheet(undefined);
    if (!count) {
      this.toast("Nothing saved yet. Use Add to create routes and places.");
      return;
    }
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
        this.name("Rename route", route.name, (name) => {
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
        name: nextName("Route", this.state.routes.map((r) => r.name)),
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
    this.click("marker-cancel", () => this.cancelMarkerEdit());
    this.click("marker-edit", () => {
      const item = this.viewedItem();
      if (item && "label" in item) this.editMarker(item);
      else if (item) this.editRouteDetails(item);
    });
    const details = this.el("marker-details");
    this.on(details, "scroll", () => {
      const card = this.dialog("marker-dialog");
      if (!card.hasAttribute("open") || card.dataset.mode !== "view") return;
      const offset = Math.min(Math.max(0, details.scrollTop), this.markerExpansionRange());
      const height = `${offset}px`;
      if (this.root.style.getPropertyValue("--place-pane-scroll") === height) return;
      this.root.style.setProperty("--place-pane-scroll", height);
      this.viewer?.cover?.(card.offsetTop);
      const item = this.viewedItem();
      if (item) this.frame(item, false);
    });
    this.on(this.dialog("marker-dialog"), "cancel", (event) => {
      if (this.dialog("marker-dialog").dataset.mode !== "edit" || !this.viewedItem()) return;
      event.preventDefault();
      this.cancelMarkerEdit();
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
    for (const input of this.root.querySelectorAll<HTMLInputElement>(
      'input[name="marker-kind"]',
    ))
      this.on(input, "change", () => {
        this.paintPlaceCard(this.markerKind());
        // Keep auto names in sync with the chosen kind until the user types.
        const label = this.input("marker-label");
        if (this.autoMarkerName && label.value === this.autoMarkerName) {
          this.autoMarkerName = this.markerName(this.markerKind());
          label.value = this.autoMarkerName;
        }
        if (!this.editingMarker && this.markerPoint)
          this.viewer?.previewPlace?.({ point: this.markerPoint, kind: this.markerKind() });
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
      this.root.style.removeProperty("--place-pane-scroll");
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
      const marker: MapMarker = {
        id: existing?.id ?? crypto.randomUUID(),
        point: this.markerPoint,
        label,
        description: this.el<HTMLTextAreaElement>("marker-description").value.trim(),
        ...(this.formPhotos.length ? { photos: [...this.formPhotos] } : {}),
        kind: this.markerKind(),
        created: existing?.created ?? Date.now(),
      };
      const unchanged = !!existing && existing.label === marker.label &&
        existing.description === marker.description && existing.kind === marker.kind &&
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
      this.toast(!existing ? `${label} saved` : unchanged ? `${label} unchanged` : `${label} updated`);
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
      this.heading = heading;
      this.orient();
      if (this.compass === "on") return;
      this.compass = "on";
      this.renderRotation();
    });
    const timer = setTimeout(() => {
      if (this.compass !== "waiting") return;
      this.compass = "missing";
      this.renderRotation();
      if (!ask && compassNeedsPermission())
        this.toast("Open Rotation and tap Auto to turn the compass back on");
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
    chip.setAttribute("aria-label", `Rotation: ${label}`);
    chip.title = `Rotation: ${label}`;
    if (this.openSheet === "rotation") this.el("sheet-title-icon").innerHTML = icon;
    for (const each of Object.keys(rotationModes))
      this.input(`rotation-${each}`).checked = each === mode;
    const compassHelp: Partial<Record<CompassStatus, string>> = {
      waiting: "Looking for the compass…",
      missing: compassNeedsPermission()
        ? "Tap Auto to turn on the compass."
        : "No compass found. Auto needs a phone or tablet.",
      blocked: "Compass access is off. Allow motion and orientation access for this site, then tap Auto.",
    };
    this.el("rotation-help").textContent =
      (mode === "compass" && compassHelp[this.compass]) || help;
    this.el("north-field").hidden = mode !== "compass";
    const wheel = this.el("north-offset"), north = this.state.northOffset;
    wheel.setAttribute("aria-valuenow", String(north));
    wheel.setAttribute("aria-valuetext", `${north}° clockwise`);
    const row = north - NORTH_MIN;
    wheel.querySelector(".selected")?.classList.remove("selected");
    wheel.children[row]?.classList.add("selected");
    // Only a wheel showing another degree moves; a scrolling one already matches.
    if (Math.round(wheel.scrollTop / NORTH_ROW_PX) !== row) wheel.scrollTop = row * NORTH_ROW_PX;
  }
  private renderDark() {
    this.el("dark-status").textContent = this.state.inverted
      ? darkMessages[this.darkKind]
      : "Off: original colors";
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
        this.movingPlace()?.label ?? "Place",
        "Drag the pin, or tap where it goes",
      ],
      marker: [icons.pin, "New place", "Tap the map where it goes"],
      route: [
        icons.route,
        route?.name ?? "Route",
        discarding
          ? this.routeStart?.points.length
            ? "Tap × again to undo your changes"
            : "Tap × again to discard this route"
          // Done waits for a second point, so the hint asks for it.
          : count > 1 ? `${plural(count, "point")} · Tap to add, drag to adjust`
          : count ? "1 point · Tap where it goes next" : "Tap where the route starts",
      ],
    };
    const [icon, title, message] = texts[this.tool];
    this.el("tool-icon").innerHTML = icon;
    this.el("tool-title").textContent = title;
    this.el("tool-message").textContent = message;
    this.el("tool-rename").hidden = this.tool !== "route";
    const cancel = this.el("tool-cancel");
    cancel.classList.toggle("armed", discarding);
    const cancelLabel = discarding ? "Discard?" : "Cancel";
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
      detail: string;
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
      title = document.createElement("strong"),
      description = document.createElement("small");
    icon.className = "row-icon";
    icon.innerHTML = options.icon;
    text.className = "row-text";
    title.textContent = options.label;
    title.title = options.label;
    description.textContent = options.detail;
    description.title = options.detail;
    text.append(title);
    if (options.detail) text.append(description);
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
    toggle.setAttribute("aria-label", `Actions for ${options.label}`);
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
    button.querySelector("span")!.textContent = armed ? "Tap again" : "Delete";
  }
  private deleteLabel(key: string) {
    return this.confirming === key ? "Tap again to delete" : "Delete";
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
        detail: marker.description,
        icon: placeIcon(marker.kind),
        jump: () => this.showDetails(marker),
        actions: [
          {
            label: "Edit",
            icon: icons.edit,
            action: () => this.editMarker(marker),
          },
          {
            label: "Move",
            icon: icons.move,
            action: () => this.moveMarker(marker),
          },
          ...(this.onShare ? [{ label: "Share", icon: icons.share,
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
        detail: `${plural(route.points.length, "point")}${route.draft ? " · unfinished" : ""}`,
        icon: this.routeIcon(route),
        jump: () => this.showDetails(route),
        actions: [
          {
            label: "Edit",
            icon: icons.edit,
            action: () => this.editRouteDetails(route),
          },
          {
            label: route.draft ? "Continue" : "Edit points",
            icon: icons.route,
            action: () => this.editRoute(route),
          },
          ...(this.onShare && !route.draft ? [{ label: "Share", icon: icons.share,
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
    // An empty list offers the one thing to do next, rather than pointing at Add.
    for (const [container, empty, label, icon, start] of [
      [markers, "No places yet.", "Add place", icons.pin, "add-marker"],
      [routes, "No routes yet.", "Draw route", icons.route, "add-route"],
    ] as const)
      if (!container.childElementCount) {
        const item = document.createElement("li");
        item.className = "empty-list";
        const text = document.createElement("span");
        text.textContent = empty;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "empty-action";
        button.innerHTML = `${icon}<span>${label}</span>`;
        button.addEventListener("click", () => this.el(start).click());
        item.append(text, button);
        container.append(item);
      }
    // Measure only after all rows are back in the list and the panel has its final height.
    this.positionRowMenu();
    this.renderTool();
  }
  refreshMetadata() {
    this.render();
  }
  // Keep detection status available to assistive technology while indexing.
  updateOcr(index: OcrIndex | undefined, message = "") {
    const sameIndex = this.ocr === index;
    this.ocr = index;
    this.ocrMessage = message;
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
    const points = (match: MapSearchMatch) =>
      match.marker ? [match.marker.point] : match.polygons.flat();
    if (this.searchMatches.some((match) => showing.call(this.viewer, points(match)))) return;
    if (first.marker) this.viewer?.jumpTo(first.marker.point);
    else this.viewer?.fitPoints(points(first));
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
      ? stepping ? `Match ${this.searchPosition + 1} of ${count}`
        : count ? `${count} ${count === 1 ? "match" : "matches"}`
        : this.ocr ? "No matching text or saved places found." : "No matching saved places yet."
      : "Search map text and saved places. Drag and zoom to explore.";
    const progress = this.ocrMessage || (!this.ocr ? "Text detection is not ready. Open the map’s Advanced settings to retry." : "");
    this.el("search-status").textContent = progress ? `${message} · ${progress}` : message;
    // The count doubles as Next, so a touch screen can step through matches
    // once Enter has put the keyboard away; it then shows where you are.
    const badge = this.el<HTMLButtonElement>("search-count");
    // A bare grey 0 is easy to miss; a miss says so in words.
    badge.textContent = stepping ? `${this.searchPosition + 1} / ${count}`
      : count ? `${count} ${count === 1 ? "match" : "matches"}` : "No matches";
    badge.insertAdjacentHTML("beforeend", icons.next);
    badge.hidden = !active;
    badge.disabled = !count;
    badge.classList.toggle("empty", !count);
    badge.setAttribute("aria-label", stepping
      ? `Match ${this.searchPosition + 1} of ${count}. Next match`
      : `${count} ${count === 1 ? "result" : "results"}`);
    this.viewer?.refreshLabels?.();
  }
  private focusSearch(delta: number) {
    // Enter never navigates the stale result of an earlier keystroke.
    if (this.searchTimer) {
      this.renderSearch();
      delta = 0;
    }
    const count = this.searchMatches.length;
    if (!count) return;
    this.searchPosition = (Math.max(0, this.searchPosition) + delta + count) % count;
    const match = this.searchMatches[this.searchPosition]!;
    // The on-screen keyboard goes away so the match is in view.
    this.input("map-search").blur();
    this.viewer?.setSearch?.(this.searchMatches, true, this.searchPosition);
    this.renderSearch(true);
    if (match.marker) this.viewer?.jumpTo(match.marker.point);
    else this.viewer?.fitPoints(match.polygons.flat());
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
