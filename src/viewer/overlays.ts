import { worldToScreen, type Camera, type Point, type Size } from "./camera";
import { icons, markerCalloutIcon } from "../ui/icons";
import { PIN_CASING, placeIcon } from "../ui/place-icon";
import { MapCallout } from "./map-callout";
import { CalloutLayout, type CalloutBounds } from "./callout-layout";
import {
  placeColor,
  routeColor,
  type Layers,
  type MapMarker,
  type NavigationState,
} from "./navigation";
import { trailAge, trailAgeChange } from "./trail";
const NS = "http://www.w3.org/2000/svg";
const node = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, value);
  return element;
};
export const CASING = PIN_CASING;

// Pin containers retain their animation and position while sharing library icons.
const pinIcon = (body: SVGGElement, markup: string, size: number) => {
  body.innerHTML = markup;
  const icon = body.querySelector("svg")!;
  icon.setAttribute("x", String(-size / 2));
  icon.setAttribute("y", String(-size / 2));
  icon.setAttribute("width", String(size));
  icon.setAttribute("height", String(size));
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  icon.style.overflow = "visible";
  return icon;
};
type Layer = keyof Layers;
interface PathItem {
  element: SVGPathElement;
  points: Point[];
  /** Its points as dots, or a chevron along each segment pointing the way it goes. */
  shape?: "dots" | "arrows";
}
/** A chevron's half width and half depth, and the shortest segment that gets one. */
const ARROW = 3.5;
const ARROW_GAP = 40;
// Screen-space SVG keeps lines/labels legible without another raster surface.
// Text is assigned through textContent; imported/user names never become markup.
// Visibility is CSS-driven (svg classes) so toggling layers needs no rebuild.
// Covers the camera glide plus two pulses (see .found in style.css).
const FOUND_MS = 2200;
/** The Measure control's neon, as --neon-measure in style.css. */
const MEASURE_COLOR = "#fff04d";
/** The Trail control's neon, as --neon-trail in style.css. */
const TRAIL_COLOR = "#ff2a2a";
/** A chevron halfway along each segment long enough on screen, pointing from
 * its first point to its second. */
export function arrows(points: Point[]) {
  let d = "";
  const at = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!,
      length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < ARROW_GAP) continue;
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length,
      mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    d += `M${at(mx - ARROW * ux - ARROW * uy, my - ARROW * uy + ARROW * ux)}` +
      `L${at(mx + ARROW * ux, my + ARROW * uy)}` +
      `L${at(mx - ARROW * ux + ARROW * uy, my - ARROW * uy - ARROW * ux)}`;
  }
  return d;
}
export class NavigationOverlay {
  private points: { element: SVGGElement; point: Point; outside?: boolean }[] = [];
  private paths: PathItem[] = [];
  private callouts: { callout: MapCallout; point: Point; padding: number; layer: Layer; priority: number; markerId?: string; routeId?: string }[] = [];
  private searchMarkers = new Set<string>();
  private anchors: CalloutBounds[] = [];
  private editing?: string;
  private moving?: string;
  private found?: string;
  private selected?: string;
  private foundTimer?: ReturnType<typeof setTimeout>;
  private ageTimer?: ReturnType<typeof setTimeout>;
  private preview?: Pick<MapMarker, "point" | "kind">;
  /** The line being measured, or the two ends of the scale being set. */
  private measure?: Point[];
  /** A finished trip being looked back on. */
  private trip?: Point[];
  private state?: NavigationState;
  constructor(private svg: SVGSVGElement) {}
  /** Highlights the route being drawn (its points become handles) or the place being moved. */
  setEditing(routeId?: string, markerId?: string) {
    this.editing = routeId;
    this.moving = markerId;
    if (this.state) this.rebuild(this.state);
  }
  /** A place or route just jumped to from Saved pulses once the map arrives. */
  setFound(id: string) {
    clearTimeout(this.foundTimer);
    this.found = id;
    if (this.state) this.rebuild(this.state);
    // Dropped in place, so later rebuilds don't replay the pulse.
    this.foundTimer = setTimeout(() => {
      this.found = undefined;
      for (const element of this.svg.querySelectorAll(".found")) element.classList.remove("found");
    }, FOUND_MS);
  }
  setSelected(id?: string) {
    if (id === this.selected) return;
    this.selected = id;
    if (this.state) this.rebuild(this.state);
  }
  /** An unsaved place, lifted like a moving pin while its details are chosen. */
  setPreview(place?: Pick<MapMarker, "point" | "kind">) {
    this.preview = place;
    if (this.state) this.rebuild(this.state);
  }
  setMeasure(points?: Point[]) {
    this.measure = points;
    if (this.state) this.rebuild(this.state);
  }
  setTrip(points?: Point[]) {
    this.trip = points;
    if (this.state) this.rebuild(this.state);
  }
  // Search owns matching place labels, avoiding duplicate callouts at the same pin.
  setSearchMarkers(ids: string[]) {
    this.searchMarkers = new Set(ids);
  }
  setLayers(layers: Layers) {
    for (const [name, visible] of Object.entries(layers))
      this.svg.classList.toggle(`hide-${name}`, !visible);
  }
  rebuild(state: NavigationState) {
    this.state = state;
    this.svg.replaceChildren();
    this.points = [];
    this.paths = [];
    // Labels carry on from where they were, so a rebuild does not make them jump.
    const previous = new Map(this.callouts.map(item => [item.markerId ?? item.routeId, item.callout]));
    this.callouts = [];
    this.setLayers(state.layers);
    const group = (layer: Layer, className = "") => {
      const element = node("g", { "data-layer": layer, class: className });
      this.svg.append(element);
      return element;
    };
    const path = (
      parent: SVGGElement,
      points: Point[],
      attributes: Record<string, string>,
      shape?: PathItem["shape"],
    ) => {
      const element = node("path", {
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...attributes,
      });
      parent.append(element);
      this.paths.push({ element, points, shape });
      return element;
    };
    const label = (
      parent: SVGGElement, text: string, point: Point,
      icon: string, color: string, padding: number, layer: Layer, priority = 0, markerId?: string, routeId?: string,
    ) => {
      const callout = new MapCallout(icon, color);
      callout.element.classList.add("overlay-label");
      callout.setText(text);
      const before = previous.get(markerId ?? routeId);
      if (before) callout.follow(before);
      parent.append(callout.element);
      this.callouts.push({ callout, point, padding, layer, priority, markerId, routeId });
    };
    const pin = (parent: SVGGElement, point: Point) => {
      const element = node("g");
      const body = node("g", { class: "pin-body" });
      element.append(body);
      parent.append(element);
      this.points.push({ element, point });
      return { element, body };
    };
    // The trail is faint and lowest: a record, not something to read.
    clearTimeout(this.ageTimer);
    const trail = node("g", { class: "trail" });
    this.svg.append(trail);
    path(trail, state.trail, { stroke: "#fff", "stroke-width": "2", "stroke-dasharray": "3 7", class: "trail-line" });
    path(trail, state.trail, { stroke: "#fff", "stroke-width": "5", class: "trail-dot" }, "dots");
    // Which way the user went, to find the way back.
    path(trail, state.trail, { stroke: "#fff", "stroke-width": "2", class: "trail-arrow" }, "arrows");
    const here = state.trail.at(-1);
    if (here) {
      const element = node("g", { class: "trail-here" });
      element.append(node("circle", { r: "18", class: "trail-pulse" }), node("circle", { r: "8", class: "trail-mark" }));
      trail.append(element);
      this.points.push({ element, point: here });
      // The pulse slows, then stops, as the position gets older.
      const age = () => {
        const now = Date.now();
        element.dataset.age = trailAge(here.time, now);
        const next = trailAgeChange(here.time, now);
        if (next !== undefined) this.ageTimer = setTimeout(age, next);
      };
      age();
    }
    // A past trip, whatever the layers: bright and whole, from start to end.
    if (this.trip) {
      const trip = node("g", { class: "trip" });
      this.svg.append(trip);
      path(trip, this.trip, { stroke: CASING, "stroke-width": "9" });
      path(trip, this.trip, { stroke: TRAIL_COLOR, "stroke-width": "4.5" });
      path(trip, this.trip, { stroke: CASING, "stroke-width": "8" }, "dots");
      path(trip, this.trip, { stroke: TRAIL_COLOR, "stroke-width": "4" }, "dots");
      path(trip, this.trip, { stroke: CASING, "stroke-width": "2" }, "arrows");
      // Its ends wear a route's start and end pins, in red.
      const ends = [
        [this.trip[0], icons.routeStart, TRAIL_COLOR, CASING],
        [this.trip.at(-1), icons.routeEnd, CASING, TRAIL_COLOR],
      ] as const;
      for (const [point, markup, fill, stroke] of ends) {
        if (!point) continue;
        const icon = pinIcon(pin(trip, point).body, markup, 20);
        icon.setAttribute("fill", fill);
        icon.setAttribute("stroke", stroke);
        icon.setAttribute("stroke-width", "3.6");
      }
    }
    // Lines first so every pin and label sits above them.
    const routes = group("routes");
    for (const route of state.routes) {
      const color = routeColor(state, route.id),
        active = route.id === this.editing,
        selected = route.id === this.selected;
      const layer = node("g", {
        class: active ? "route editing" : route.id === this.found ? "route found" : "route",
      });
      if (selected) layer.classList.add("selected");
      routes.append(layer);
      path(layer, route.points, { stroke: CASING, "stroke-width": "9", class: "route-casing" });
      path(layer, route.points, {
        stroke: color,
        "stroke-width": "4.5",
        class: "route-line",
        ...(route.draft && !active ? { "stroke-dasharray": "10 8" } : {}),
      });
      path(
        layer,
        route.points,
        { stroke: CASING, "stroke-width": "8", class: "route-dot-casing" },
        "dots",
      );
      path(
        layer,
        route.points,
        { stroke: color, "stroke-width": "4", class: "route-dot" },
        "dots",
      );
      const start = route.points[0];
      if (start) {
        const { element, body } = pin(layer, start);
        element.classList.add("route-start");
        const icon = pinIcon(body, icons.routeStart, 20);
        icon.setAttribute("fill", color);
        icon.setAttribute("stroke", CASING);
        icon.setAttribute("stroke-width", "3.6");
        const raised = active || selected;
        label(layer, route.name, start, icons.route, color, raised ? 10 : 8, "routes", raised ? 1 : 0, undefined, route.id);
      }
      const end = route.points.at(-1);
      if (end && route.points.length > 1) {
        const { body } = pin(layer, end);
        const icon = pinIcon(body, icons.routeEnd, 20);
        icon.setAttribute("fill", CASING);
        icon.setAttribute("stroke", color);
        icon.setAttribute("stroke-width", "3.6");
      }
    }
    const placeBody = (body: SVGGElement, kind: MapMarker["kind"], levels?: Pick<MapMarker, "water" | "danger">) => {
      pinIcon(body, placeIcon(kind, levels), 24);
    };
    const places = group("places");
    for (const marker of state.markers) {
      const color = placeColor(marker);
      const { element, body } = pin(places, marker.point);
      if (marker.id === this.moving) element.classList.add("moving");
      else if (marker.id === this.found) element.classList.add("found");
      if (marker.id === this.selected) element.classList.add("selected");
      placeBody(body, marker.kind, marker);
      const raised = marker.id === this.moving || marker.id === this.selected;
      label(places, marker.label, marker.point, markerCalloutIcon(marker.kind), color, raised ? 18 : 12, "places", raised ? 2 : 0, marker.id);
    }
    // Shown even with the places layer hidden: it is what the user is adding.
    if (this.preview) {
      const preview = node("g", { class: "place-preview" });
      this.svg.append(preview);
      const { element, body } = pin(preview, this.preview.point);
      element.classList.add("moving");
      placeBody(body, this.preview.kind);
    }
    // A tape over everything, whatever the layers: its points are the handles.
    if (this.measure) {
      const tape = node("g", { class: "measure" });
      this.svg.append(tape);
      path(tape, this.measure, { stroke: CASING, "stroke-width": "8" });
      path(tape, this.measure, { stroke: MEASURE_COLOR, "stroke-width": "4", "stroke-dasharray": "12 8" });
      path(tape, this.measure, { stroke: CASING, "stroke-width": "18" }, "dots");
      path(tape, this.measure, { stroke: MEASURE_COLOR, "stroke-width": "12" }, "dots");
    }
    // Higher priority claims space first; sorted here, not on every frame.
    this.callouts.sort((a, b) => b.priority - a.priority);
  }
  private visible(layer: Layer) {
    return !!this.svg.parentElement?.classList.contains("spotlight") ||
      !this.svg.classList.contains(`hide-${layer}`);
  }
  // Reserve every visible pin and route vertex before placing any label.
  reserve(camera: Camera, layout: CalloutLayout) {
    this.anchors = [];
    const reservePoint = (point: Point, padding: number) => {
      const p = worldToScreen(camera, point);
      const bounds = { left: p.x - padding, right: p.x + padding,
        top: p.y - padding, bottom: p.y + padding };
      this.anchors.push(bounds);
      layout.addObstacle(bounds);
    };
    if (this.visible("places"))
      for (const marker of this.state?.markers ?? [])
        // A water ring widens the pin a little; keep labels off it too.
        reservePoint(marker.point, (marker.id === this.moving || marker.id === this.selected ? 18 : 12) +
          (marker.water && marker.kind === "flooded" ? 4 : 0));
    if (this.visible("routes"))
      for (const route of this.state?.routes ?? [])
        for (const point of route.points)
          reservePoint(point, route.id === this.editing ? 10 : 8);
    if (this.preview) reservePoint(this.preview.point, 18);
    for (const point of this.measure ?? []) reservePoint(point, 10);
    for (const point of this.trip ?? []) reservePoint(point, 8);
  }
  /** Draws one frame; returns whether a label is still gliding or fading.
   * Zoomed out, `named` is false and only pins show. */
  draw(camera: Camera, viewport: Size, layout?: CalloutLayout, named = true) {
    const labels = layout ?? new CalloutLayout(viewport);
    if (!layout) this.reserve(camera, labels);
    let gliding = false;
    this.svg.setAttribute(
      "viewBox",
      `0 0 ${viewport.width} ${viewport.height}`,
    );
    // A route's five paths share its points: casing, line and flow draw one
    // outline and both dot layers another, so each is built once per frame.
    let points: Point[] | undefined, screen: Point[] = [], line = "", dots = "";
    for (const path of this.paths) {
      if (path.points !== points) {
        points = path.points;
        screen = points.map((point) => worldToScreen(camera, point));
        line = dots = "";
        for (const [i, p] of screen.entries()) {
          const x = p.x.toFixed(1),
            y = p.y.toFixed(1);
          line += `${i ? "L" : "M"}${x},${y}`;
          // Zero-length round-capped segments render as vertex dots.
          dots += `M${x},${y}h0`;
        }
      }
      path.element.setAttribute("d", path.shape === "dots" ? dots : path.shape === "arrows" ? arrows(screen) : line);
    }
    for (const pin of this.points) {
      const p = worldToScreen(camera, pin.point);
      const outside =
        p.x < -150 ||
        p.y < -100 ||
        p.x > viewport.width + 100 ||
        p.y > viewport.height + 100;
      if (outside !== pin.outside) {
        pin.outside = outside;
        pin.element.style.display = outside ? "none" : "";
      }
      if (!outside) pin.element.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    }
    for (const { callout, point, padding, layer, priority, markerId } of this.callouts) {
      if ((markerId && this.searchMarkers.has(markerId)) || !this.visible(layer) || !this.visible("labels")) {
        callout.hide();
        continue;
      }
      const p = worldToScreen(camera, point);
      let bounds = {
        left: p.x - padding, right: p.x + padding,
        top: p.y - padding, bottom: p.y + padding,
      };
      // A route can start on a place: connect outside the combined symbols.
      // Anchors reach at most 36px from a pin, so one this far out has none.
      if (p.x >= -40 && p.y >= -40 && p.x <= viewport.width + 40 && p.y <= viewport.height + 40)
        for (const anchor of this.anchors)
          if (p.x >= anchor.left && p.x <= anchor.right && p.y >= anchor.top && p.y <= anchor.bottom)
            bounds = { left: Math.min(bounds.left, anchor.left), right: Math.max(bounds.right, anchor.right),
              top: Math.min(bounds.top, anchor.top), bottom: Math.max(bounds.bottom, anchor.bottom) };
      // The selected, moving or edited item keeps its label when zoomed out.
      if (callout.draw(p, viewport, bounds, labels, named || priority > 0)) gliding = true;
    }
    return gliding;
  }
  /** The place or route whose label chip covers this screen point, if any. */
  labelAt(screen: Point): { markerId?: string; routeId?: string } | undefined {
    for (const { callout, markerId, routeId } of this.callouts) {
      const bounds = callout.bounds;
      if (bounds && screen.x >= bounds.left && screen.x <= bounds.right &&
        screen.y >= bounds.top && screen.y <= bounds.bottom) return { markerId, routeId };
    }
  }
  dispose() {
    clearTimeout(this.foundTimer);
    clearTimeout(this.ageTimer);
    this.svg.replaceChildren();
  }
}
