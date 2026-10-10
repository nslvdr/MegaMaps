import { showDialog } from "./dialog";
import type { MapRecord } from "../types";
import type { Point } from "../viewer/camera";
import type { DarkMode } from "../viewer/appearance";
import { NavigationPersistence, loadNavigation } from "../storage/navigation";
import { preserveUnseenImports } from "../sharing/annotations";
import { Viewer, type ViewerOptions } from "../viewer/viewer";
import {
  BRIGHTNESS_LEVELS,
  DEFAULT_DIMMING,
  insideImage,
  layerNames,
  markerKinds,
  routeColor,
  type NavigationState,
  type Tool,
  type MapMarker,
  type PlannedRoute,
} from "../viewer/navigation";
import { icons } from "./icons";
import { plural } from "./format";
import { placeIcon } from "./place-icon";
import { popoverPosition } from "./popover-position";
import {
  normalizeText,
  type OcrIndex,
} from "../ocr/index";
import { searchMap, type MapSearchMatch } from "../viewer/map-search";
import { stepFocus, typeahead } from "./step-focus";
const sheets = ["display", "saved", "search"] as const;
const copyPoints = (points: Point[]) => points.map((point) => ({ ...point }));
type Sheet = (typeof sheets)[number];
const SEARCH_DEBOUNCE_MS = 200;
const SPOTLIGHT_MS = 4500;
const darkMessages: Record<DarkMode["kind"], string> = {
  inverted: "Colors inverted, background pure black",
  deepened: "Background deepened to pure black",
  "already-dark": "Map is already dark",
};

// Owns map tools/dialogs and saves; the renderer only knows coordinates/appearance.
export class ViewerControls {
  private viewer?: Pick<
    Viewer,
    "setTool" | "updateNavigation" | "rotateTo" | "jumpTo" | "fitPoints"
  > &
    Partial<Pick<Viewer, "setSearch" | "refreshLabels" | "previewPlace">>;
  private ocr?: OcrIndex;
  private shownRotation?: number;
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
  private markerPoint?: Point;
  private autoMarkerName = "";
  private nameAction?: (name: string) => void;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private spotlightTimer?: ReturnType<typeof setTimeout>;
  private confirmTimer?: ReturnType<typeof setTimeout>;
  private confirming?: string;
  private rowMenu?: string;
  private rowMenuAnchor?: HTMLElement;
  private rowPopover?: HTMLElement;
  /** Add was tapped: Place / Route float above the pill until one is picked. */
  private choosing = false;
  private openSheet?: Sheet;
  private darkKind: DarkMode["kind"] = "inverted";
  /** New places start as the kind last saved, for runs of entrances or notes. */
  private newMarkerKind: MapMarker["kind"] = "landmark";
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
  ) {
    target.addEventListener(type, action, { signal: this.controller.signal });
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
        return ["back", "dock", "sheet", "add-bar", "tool-bar"].flatMap(id => {
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
        this.renderView();
      },
      onTap: (point) => this.onTap(point),
      onMarker: (marker) => this.editMarker(marker),
      // Long-press drops a place without going through Add.
      onLongPress: (point) => {
        if (this.tool !== "browse") return;
        navigator.vibrate?.(12);
        if (this.choosing) this.choose(false);
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
  private toast(message: string) {
    const toast = this.el("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    // Long hints stay up longer: 50 ms a character (a word in about 0.3 s), up to 6 s.
    this.toastTimer = setTimeout(() => (toast.hidden = true), Math.min(6000, 1500 + message.length * 50));
  }
  private sheet(name: Sheet | undefined, returnFocus = false) {
    const previous = this.openSheet;
    if (previous === "search" && name !== "search") {
      this.input("map-search").blur();
      this.input("map-search").value = "";
      this.renderSearch();
    }
    this.choosing = false;
    this.openSheet = name;
    // Row menus start closed each time a panel opens.
    if (name !== previous) this.closeRowMenu();
    this.el("sheet").hidden = !name;
    // Tints the panel with its pill button's neon color.
    this.el("sheet").dataset.panel = name ?? "";
    this.el("sheet").style.transform = "";
    this.el("sheet-dismiss").hidden = !name || name === "search";
    this.el("close-sheet").hidden = name === "search";
    this.el("share-saved").hidden = name !== "saved" || !this.onShare;
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
    this.renderTool();
    if (!name && returnFocus && previous) this.el(`open-${previous}`).focus();
  }
  /** "/" opens Search ready to type: a keyboard is already at hand, unlike a tap. */
  openSearch() {
    if (this.tool !== "browse" || this.root.querySelector("dialog[open]")) return false;
    this.sheet("search");
    this.input("map-search").focus();
    return true;
  }
  /** Next (or previous) match. Enter puts the keyboard away, so later
   * presses arrive from outside the field and step on from there. */
  stepSearch(back = false) {
    if (this.openSheet !== "search") return false;
    this.focusSearch(back ? -1 : this.searchPosition < 0 ? 0 : 1);
    return true;
  }
  private choose(open: boolean) {
    this.sheet(undefined);
    this.choosing = open;
    this.renderTool();
    if (!open) this.el("open-add").focus();
  }
  private mode(tool: Tool) {
    this.tool = tool;
    this.viewer?.setTool(
      tool,
      tool === "move" ? this.movingMarker : this.activeRoute,
    );
    this.sheet(undefined);
    this.renderTool();
    this.el("map-canvas").focus();
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
  private openMarker(title: string, point: Point, marker?: MapMarker) {
    this.editingMarker = marker?.id;
    this.markerPoint = point;
    const kind = marker?.kind ?? this.newMarkerKind;
    this.autoMarkerName = marker
      ? ""
      : `${markerKinds[kind].label} ${this.state.markers.length + 1}`;
    this.el("marker-dialog-title").textContent = title;
    this.input("marker-label").value = marker?.label ?? this.autoMarkerName;
    this.setMarkerKind(kind);
    this.el<HTMLTextAreaElement>("marker-note").value = marker?.note ?? "";
    this.el("marker-delete").hidden = !marker;
    // Notes stay tucked away unless there already is one.
    this.notes(!!marker?.note);
    // A new place shows where it will go while it is named.
    if (!marker) this.viewer?.previewPlace?.({ point, kind });
    showDialog(this.dialog("marker-dialog"));
  }
  private notes(open: boolean) {
    this.el("marker-note-field").hidden = !open;
    this.el("marker-add-note").hidden = open;
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
      this.toast(
        start.points.length
          ? `Tap × again to undo your changes to ${route.name}`
          : `Tap × again to discard ${route.name}`,
      );
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
    this.on(this.root, "click", event => {
      const target = event.target as Element;
      if (this.openSheet === "search" && !target.closest(".search-field, #open-search"))
        this.sheet(undefined);
    });
    this.on(this.el("map-canvas"), "pointerdown", () => {
      if (this.openSheet === "search") this.input("map-search").blur();
    });
    this.on(this.input("map-search"), "input", () => this.queueSearch());
    this.on(this.input("map-search"), "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key === "Enter" && !key.isComposing) {
        key.preventDefault();
        this.stepSearch(key.shiftKey);
      }
    });
    for (const sheet of sheets)
      this.click(`open-${sheet}`, () =>
        this.sheet(this.openSheet === sheet ? undefined : sheet, true),
      );
    this.click("close-sheet", () => this.sheet(undefined, true));
    this.click("sheet-dismiss", () => this.sheet(undefined, true));
    this.bindSheetDrag();
    const typeToJump = typeahead((item) => item.closest(".navigation-row")?.querySelector("strong")?.textContent ?? "");
    this.on(this.root, "keydown", (event) => {
      const key = event as KeyboardEvent, target = key.target as Element;
      if (key.key === "Escape") {
        if (!this.escape()) return;
        event.preventDefault();
        event.stopPropagation();
      // Arrows walk an open row menu (from its ⋯ too), otherwise the Saved rows,
      // where typing a name's first letters also jumps to it.
      } else if (this.rowPopover && (target === this.rowMenuAnchor || this.rowPopover.contains(target)))
        stepFocus(key, [...this.rowPopover.querySelectorAll<HTMLElement>(".popover-item")], true);
      else if (target.closest?.("#sheet-saved .navigation-row")) {
        const column = target.closest(".row-more") ? ".row-more" : ".navigation-jump";
        const rows = [...this.el("sheet-saved").querySelectorAll<HTMLElement>(`.navigation-row ${column}`)];
        if (!typeToJump(key, rows)) stepFocus(key, rows);
      }
    });
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
    this.click("rotation-lock", () => {
      this.state.rotationLocked = !this.state.rotationLocked;
      this.changed();
      this.toast(
        this.state.rotationLocked
          ? "Rotation locked"
          : "Rotation unlocked · twist with two fingers",
      );
    });
    this.on(this.input("rotation-angle"), "input", () => {
      const angle = this.input("rotation-angle");
      // North sits at both ends of the slider; a near miss snaps to it.
      const degrees = Number(angle.value);
      if (degrees <= 4 || degrees >= 356) angle.value = "0";
      this.viewer?.rotateTo((Number(angle.value) * Math.PI) / 180);
    });
    this.click("rotate-left", () => this.rotateStep(-1));
    this.click("rotate-right", () => this.rotateStep(1));
    for (const level of BRIGHTNESS_LEVELS) {
      const input = this.input(`brightness-${level * 100}`);
      this.on(input, "change", () => {
        if (!input.checked) return;
        this.state.dimming = level;
        this.changed();
      });
    }
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
    // Add's button turns into × : it closes the choice or cancels the tool.
    this.click("open-add", () => {
      if (this.tool === "route") this.cancelRoute();
      else if (this.tool === "move") this.finishMove(false);
      else if (this.tool !== "browse") this.mode("browse");
      else this.choose(!this.choosing);
    });
    this.click("add-marker", () => this.mode("marker"));
    this.click("share-saved", () => this.onShare?.());
    // Start drawing immediately; the default name can be changed from Saved.
    this.click("add-route", () => {
      const route: PlannedRoute = {
        id: crypto.randomUUID(),
        name: `Route ${this.state.routes.length + 1}`,
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
    this.click("marker-cancel", () => this.dialog("marker-dialog").close());
    this.click("marker-add-note", () => {
      this.notes(true);
      this.el("marker-note").focus();
    });
    this.click("marker-delete", () => {
      this.state.markers = this.state.markers.filter(
        (m) => m.id !== this.editingMarker,
      );
      this.dialog("marker-dialog").close();
      this.changed();
      this.mode("browse");
      this.toast("Place deleted");
    });
    for (const input of this.root.querySelectorAll<HTMLInputElement>(
      'input[name="marker-kind"]',
    ))
      this.on(input, "change", () => {
        // Keep auto names in sync with the chosen kind until the user types.
        const label = this.input("marker-label");
        if (this.autoMarkerName && label.value === this.autoMarkerName) {
          this.autoMarkerName = `${markerKinds[this.markerKind()].label} ${this.state.markers.length + 1}`;
          label.value = this.autoMarkerName;
        }
        if (!this.editingMarker && this.markerPoint)
          this.viewer?.previewPlace?.({ point: this.markerPoint, kind: this.markerKind() });
      });
    this.on(this.dialog("marker-dialog"), "close", () => this.viewer?.previewPlace?.());
    // ⌘/Ctrl+Enter saves from the note, where Enter starts a new line.
    this.on(this.el("marker-note"), "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== "Enter" || !(key.metaKey || key.ctrlKey) || key.isComposing) return;
      key.preventDefault();
      this.el<HTMLFormElement>("marker-form").requestSubmit();
    });
    this.on(this.el("marker-form"), "submit", (event) => {
      event.preventDefault();
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
        note: this.el<HTMLTextAreaElement>("marker-note").value.trim(),
        kind: this.markerKind(),
        created: existing?.created ?? Date.now(),
      };
      this.state.markers = this.state.markers.filter((m) => m.id !== marker.id);
      this.state.markers.push(marker);
      if (!existing) this.newMarkerKind = marker.kind;
      this.dialog("marker-dialog").close();
      this.changed();
      this.mode("browse");
      this.toast(existing ? "Place updated" : `${label} saved`);
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
  // Swipe the sheet header down to dismiss it, like native bottom sheets.
  private bindSheetDrag() {
    const sheet = this.el("sheet");
    let start: number | undefined, offset = 0;
    for (const handle of [this.el("sheet-grabber"), this.el("sheet-title")]) {
      this.on(handle, "pointerdown", (event) => {
        const pointer = event as PointerEvent;
        start = pointer.clientY;
        offset = 0;
        handle.setPointerCapture?.(pointer.pointerId);
        sheet.classList.add("dragging");
      });
      this.on(handle, "pointermove", (event) => {
        if (start === undefined) return;
        offset = Math.max(0, (event as PointerEvent).clientY - start);
        sheet.style.transform = `translateY(${offset}px)`;
        this.viewer?.refreshLabels?.();
      });
      for (const type of ["pointerup", "pointercancel"])
        this.on(handle, type, () => {
          if (start === undefined) return;
          start = undefined;
          sheet.classList.remove("dragging");
          if (offset > 70) this.sheet(undefined, true);
          else {
            sheet.style.transform = "";
            this.viewer?.refreshLabels?.();
          }
        });
    }
  }
  private renderView() {
    const rotation =
      ((Math.round(((this.state.view?.rotation ?? 0) * 180) / Math.PI) % 360) +
        360) %
      360;
    // Runs on every camera move: untouched DOM keeps panning free of layout work.
    if (rotation === this.shownRotation) return;
    this.shownRotation = rotation;
    this.input("rotation-angle").value = String(rotation);
    this.el("rotation-value").textContent = `${rotation}°`;
  }
  private renderDark() {
    this.el("dark-status").textContent = this.state.inverted
      ? darkMessages[this.darkKind]
      : "Off: original colors";
  }
  /** Keyboard undo while drawing a route; false when there is nothing to undo. */
  /** Steps land on the 15° grid, so a few presses always reach north again.
   * False while rotation is locked. */
  rotateStep(direction: 1 | -1) {
    if (this.state.rotationLocked || !this.viewer) return false;
    const steps = ((this.state.view?.rotation ?? 0) * 12) / Math.PI;
    const next = direction > 0
      ? Math.floor(steps + 1e-6) + 1
      : Math.ceil(steps - 1e-6) - 1;
    this.viewer.rotateTo((next * Math.PI) / 12);
    return true;
  }
  undo() {
    const button = this.el<HTMLButtonElement>("route-undo");
    if (button.hidden || button.disabled) return false;
    button.click();
    return true;
  }
  /** Backs out one level (sheet → tool → browse); false when already browsing. */
  escape() {
    if (this.root.querySelector("dialog[open]")) return false;
    if (this.rowMenu) {
      this.closeRowMenu(true);
    } else if (this.openSheet) this.sheet(undefined, true);
    else if (this.choosing) this.choose(false);
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
    // Search replaces the pill; the other panels and placing tools sit above it.
    this.el("dock").hidden = this.openSheet === "search";
    this.el("add-bar").hidden = !this.choosing;
    const add = this.el("open-add");
    add.setAttribute("aria-expanded", String(this.choosing));
    add.classList.toggle("active", editing || this.choosing);
    this.el("open-add-label").textContent = editing
      ? this.confirming === "cancel-route"
        ? "Discard?"
        : "Cancel"
      : this.choosing
        ? "Close"
        : "Add";
    // One task at a time: the panels wait until placing is over.
    for (const sheet of sheets)
      this.el<HTMLButtonElement>(`open-${sheet}`).disabled = editing;
    this.el("tool-bar").hidden = !editing || sheetOpen;
    const route = this.route();
    const count = route?.points.length ?? 0;
    const texts: Record<Tool, [string, string]> = {
      browse: ["", ""],
      move: [
        this.movingPlace()?.label ?? "Place",
        "Drag the pin, or tap where it goes",
      ],
      marker: ["New place", "Tap the map where it goes"],
      route: [
        `${route?.name ?? "Route"} · ${plural(count, "point")}`,
        count ? "Tap to add, drag points to adjust" : "Tap where the route starts",
      ],
    };
    const [title, message] = texts[this.tool];
    this.el("tool-title").textContent = title;
    this.el("tool-message").textContent = message;
    this.el("tool-actions").hidden = this.tool !== "route" && this.tool !== "move";
    this.el("route-undo").hidden = this.tool !== "route";
    this.el<HTMLButtonElement>("route-undo").disabled =
      !count && !this.routeHistory.length;
    this.el<HTMLButtonElement>("tool-done").disabled =
      this.tool === "route" && count < 2;
  }
  // Saved list items: tap to jump; ⋯ opens actions outside the scrolling list.
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
    text.append(title, description);
    button.append(icon, text);
    button.addEventListener("click", () => {
      options.jump();
      this.sheet(undefined);
      // The keyboard carries on from the map: arrows pan, +/− zoom.
      this.el("map-canvas").focus({ preventScroll: true });
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
  private closeRowMenu(returnFocus = false) {
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
    if (returnFocus) anchor?.focus({ preventScroll: true });
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
  private deleteLabel(key: string) {
    return this.confirming === key ? "Tap again to delete" : "Delete";
  }
  private render() {
    const rotationLock = this.el("rotation-lock");
    rotationLock.setAttribute(
      "aria-pressed",
      String(this.state.rotationLocked),
    );
    rotationLock.setAttribute(
      "aria-label",
      this.state.rotationLocked ? "Unlock rotation" : "Lock rotation",
    );
    this.input("dark-map").checked = this.state.inverted;
    for (const level of BRIGHTNESS_LEVELS)
      this.input(`brightness-${level * 100}`).checked = this.state.dimming === level;
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
    this.el("rotation-controls").hidden = this.state.rotationLocked;
    const focusedMenuIndex = this.rowPopover
      ? [...this.rowPopover.querySelectorAll("button")].findIndex(
          (button) => button === document.activeElement,
        )
      : -1;
    this.rowPopover?.remove();
    this.rowPopover = undefined;
    this.rowMenuAnchor = undefined;
    const markers = this.el("marker-list"),
      routes = this.el("route-list");
    markers.replaceChildren();
    routes.replaceChildren();
    for (const marker of this.state.markers) {
      const kind = markerKinds[marker.kind] ?? markerKinds.landmark;
      this.row(markers, {
        key: marker.id,
        label: marker.label,
        detail: `${kind.label}${marker.note ? " · " + marker.note : ""}`,
        icon: placeIcon(marker.kind),
        jump: () => this.viewer?.jumpTo(marker.point),
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
              this.state.markers = this.state.markers.filter(
                (m) => m.id !== marker.id,
              );
              this.changed();
              this.toast("Place deleted");
            }),
          },
        ],
      });
    }
    for (const route of this.state.routes)
      this.row(routes, {
        key: route.id,
        label: route.name,
        detail: `${plural(route.points.length, "point")}${route.draft ? " · unfinished" : ""}`,
        icon: icons.route.replace(
          "<svg ",
          `<svg style="color:${routeColor(this.state, route.id)}" `,
        ),
        jump: () => this.viewer?.fitPoints(route.points),
        actions: [
          {
            label: route.draft ? "Continue" : "Edit points",
            icon: icons.edit,
            action: () => this.editRoute(route),
          },
          {
            label: "Rename",
            icon: icons.text,
            action: () =>
              this.name("Rename route", route.name, (name) => {
                route.name = name;
                this.changed();
              }),
          },
          ...(this.onShare && !route.draft ? [{ label: "Share", icon: icons.share,
            action: () => this.onShare?.({ kind: "route", id: route.id }) }] : []),
          {
            label: this.deleteLabel(route.id),
            icon: icons.trash,
            danger: true,
            action: this.confirmDelete(route.id, () => {
              this.rowMenu = undefined;
              this.state.routes = this.state.routes.filter(
                (r) => r.id !== route.id,
              );
              if (this.activeRoute === route.id) {
                this.activeRoute = undefined;
                this.mode("browse");
              }
              this.changed();
            }),
          },
        ],
      });
    for (const [container, empty] of [
      [markers, "No places yet. Use Add › Place."],
      [routes, "No routes yet. Use Add › Route, then tap along passages."],
    ] as const)
      if (!container.childElementCount && empty) {
        const item = document.createElement("li");
        item.className = "empty-list";
        item.textContent = empty;
        container.append(item);
      }
    // Measure only after all rows are back in the list and the panel has its final height.
    this.positionRowMenu();
    if (focusedMenuIndex >= 0)
      this.root
        .querySelectorAll<HTMLButtonElement>(".row-popover button")
        [focusedMenuIndex]?.focus({ preventScroll: true });
    this.renderView();
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
    this.searchTimer = setTimeout(() => this.renderSearch(), SEARCH_DEBOUNCE_MS);
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
    const message = active
      ? count ? `${count} ${count === 1 ? "match" : "matches"}`
        : this.ocr ? "No matching text or saved places found." : "No matching saved places yet."
      : "Search map text and saved places. Drag and zoom to explore.";
    const progress = this.ocrMessage || (!this.ocr ? "Text detection is not ready. Open the map’s Advanced settings to retry." : "");
    this.el("search-status").textContent = progress ? `${message} · ${progress}` : message;
    const badge = this.el("search-count");
    badge.textContent = String(count);
    badge.hidden = !active;
    badge.setAttribute("aria-label", `${count} ${count === 1 ? "result" : "results"}`);
    badge.title = this.el("search-status").textContent ?? "";
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
    // Hands focus to the map: the on-screen keyboard goes away, and arrows
    // pan around the match while Enter keeps stepping.
    this.el("map-canvas").focus({ preventScroll: true });
    this.viewer?.setSearch?.(this.searchMatches, true, this.searchPosition);
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
    clearTimeout(this.confirmTimer);
    this.el("map-stage").classList.remove("spotlight");
    this.el("toast").hidden = true;
    const saved = this.flush();
    this.controller.abort();
    this.dialog("marker-dialog").close();
    this.dialog("name-dialog").close();
    return saved;
  }
}
