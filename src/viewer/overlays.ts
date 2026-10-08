import { worldToScreen, type Camera, type Point, type Size } from "./camera";
import { icons } from "../ui/icons";
import { MapCallout } from "./map-callout";
import { CalloutLayout, type CalloutBounds } from "./callout-layout";
import {
  markerKinds,
  routeColor,
  type Layers,
  type MapMarker,
  type NavigationState,
} from "./navigation";
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
// Small glyphs drawn inside 22px pins, in pin-local coordinates.
export const glyphs: Record<MapMarker["kind"], { d: string; fill?: boolean }> = {
  landmark: {
    d: "M0,-6.5L1.9,-2.1 6.5,-2.1 2.8,0.9 4,5.6 0,2.9 -4,5.6 -2.8,0.9 -6.5,-2.1 -1.9,-2.1Z",
    fill: true,
  },
  entrance: { d: "M-5,5V0A5,5 0 0 1 5,0V5" },
  junction: { d: "M0,6V0M0,0L-5,-5M0,0L5,-5" },
  bookmark: { d: "M-3,6V-6H5L3,-3L5,0H-3" },
  note: { d: "M-4,-3H4M-4,0H4M-4,3H1" },
};
// Trusted app glyphs shared by saved-place and search callouts.
export const markerCalloutIcon = (kind: MapMarker["kind"]) => {
  const glyph = glyphs[kind] ?? glyphs.bookmark;
  return `<svg viewBox="-9 -9 18 18" aria-hidden="true"><path d="${glyph.d}" fill="${glyph.fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${glyph.fill ? 0.8 : 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};
export const CASING = "#05070a";
type Layer = keyof Layers;
interface PathItem {
  element: SVGPathElement;
  points: Point[];
  dots?: boolean;
}
// Screen-space SVG keeps lines/labels legible without another raster surface.
// Text is assigned through textContent; imported/user names never become markup.
// Visibility is CSS-driven (svg classes) so toggling layers needs no rebuild.
export class NavigationOverlay {
  private points: { element: SVGGElement; point: Point }[] = [];
  private paths: PathItem[] = [];
  private callouts: { callout: MapCallout; point: Point; padding: number; layer: Layer; priority: number; markerId?: string }[] = [];
  private searchMarkers = new Set<string>();
  private anchors: CalloutBounds[] = [];
  private editing?: string;
  private moving?: string;
  private state?: NavigationState;
  constructor(private svg: SVGSVGElement) {}
  /** Highlights the route being drawn (its points become handles) or the place being moved. */
  setEditing(routeId?: string, markerId?: string) {
    this.editing = routeId;
    this.moving = markerId;
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
      dots = false,
    ) => {
      const element = node("path", {
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...attributes,
      });
      parent.append(element);
      this.paths.push({ element, points, dots });
      return element;
    };
    const label = (
      parent: SVGGElement, text: string, point: Point,
      icon: string, color: string, padding: number, layer: Layer, priority = 0, markerId?: string,
    ) => {
      const callout = new MapCallout(icon, color);
      callout.element.classList.add("overlay-label");
      callout.setText(text);
      parent.append(callout.element);
      this.callouts.push({ callout, point, padding, layer, priority, markerId });
    };
    const pin = (parent: SVGGElement, point: Point) => {
      const element = node("g");
      const body = node("g", { class: "pin-body" });
      element.append(body);
      parent.append(element);
      this.points.push({ element, point });
      return { element, body };
    };
    // Lines first so every pin and label sits above them.
    const routes = group("routes");
    for (const route of state.routes) {
      const color = routeColor(state, route.id),
        active = route.id === this.editing;
      const layer = node("g", { class: active ? "route editing" : "route" });
      routes.append(layer);
      path(layer, route.points, { stroke: CASING, "stroke-width": "9" });
      path(layer, route.points, {
        stroke: color,
        "stroke-width": "4.5",
        class: "route-line",
        ...(route.draft && !active ? { "stroke-dasharray": "10 8" } : {}),
      });
      path(layer, route.points, { class: "route-flow" });
      path(
        layer,
        route.points,
        { stroke: CASING, "stroke-width": "8", class: "route-dot-casing" },
        true,
      );
      path(
        layer,
        route.points,
        { stroke: color, "stroke-width": "4", class: "route-dot" },
        true,
      );
      const start = route.points[0];
      if (start) {
        const { element, body } = pin(layer, start);
        element.classList.add("route-start");
        body.append(
          node("circle", { r: "8", fill: color, stroke: CASING, "stroke-width": "3" }),
        );
        label(layer, route.name, start, icons.route, color, active ? 10 : 8, "routes", active ? 1 : 0);
      }
      const end = route.points.at(-1);
      if (end && route.points.length > 1) {
        const { body } = pin(layer, end);
        body.append(
          node("rect", {
            x: "-7",
            y: "-7",
            width: "14",
            height: "14",
            rx: "3",
            fill: CASING,
            stroke: color,
            "stroke-width": "3",
          }),
        );
      }
    }
    const places = group("places");
    for (const marker of state.markers) {
      const { color } = markerKinds[marker.kind] ?? markerKinds.bookmark;
      const glyph = glyphs[marker.kind] ?? glyphs.bookmark;
      const { element, body } = pin(places, marker.point);
      if (marker.id === this.moving) element.classList.add("moving");
      body.append(
        node("circle", { r: "11", fill: color, stroke: CASING, "stroke-width": "2.5" }),
        node("path", {
          d: glyph.d,
          fill: glyph.fill ? CASING : "none",
          stroke: CASING,
          "stroke-width": glyph.fill ? "0.8" : "2",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      );
      const moving = marker.id === this.moving;
      label(places, marker.label, marker.point, markerCalloutIcon(marker.kind), color, moving ? 18 : 12, "places", moving ? 2 : 0, marker.id);
    }
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
        reservePoint(marker.point, marker.id === this.moving ? 18 : 12);
    if (this.visible("routes"))
      for (const route of this.state?.routes ?? [])
        for (const point of route.points)
          reservePoint(point, route.id === this.editing ? 10 : 8);
  }
  draw(camera: Camera, viewport: Size, layout?: CalloutLayout) {
    const labels = layout ?? new CalloutLayout(viewport);
    if (!layout) this.reserve(camera, labels);
    this.svg.setAttribute(
      "viewBox",
      `0 0 ${viewport.width} ${viewport.height}`,
    );
    for (const path of this.paths) {
      let d = "";
      for (const [i, point] of path.points.entries()) {
        const p = worldToScreen(camera, point);
        const x = p.x.toFixed(1),
          y = p.y.toFixed(1);
        // Zero-length round-capped segments render as vertex dots.
        d += path.dots ? `M${x},${y}h0` : `${i ? "L" : "M"}${x},${y}`;
      }
      path.element.setAttribute("d", d);
    }
    for (const pin of this.points) {
      const p = worldToScreen(camera, pin.point);
      const outside =
        p.x < -150 ||
        p.y < -100 ||
        p.x > viewport.width + 100 ||
        p.y > viewport.height + 100;
      pin.element.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      pin.element.style.display = outside ? "none" : "";
    }
    for (const { callout, point, padding, layer, markerId } of [...this.callouts].sort((a, b) => b.priority - a.priority)) {
      if ((markerId && this.searchMarkers.has(markerId)) || !this.visible(layer) || !this.visible("labels")) {
        callout.element.setAttribute("hidden", "");
        continue;
      }
      const p = worldToScreen(camera, point);
      let bounds = {
        left: p.x - padding, right: p.x + padding,
        top: p.y - padding, bottom: p.y + padding,
      };
      // A route can start on a place: connect outside the combined symbols.
      for (const anchor of this.anchors)
        if (p.x >= anchor.left && p.x <= anchor.right && p.y >= anchor.top && p.y <= anchor.bottom)
          bounds = { left: Math.min(bounds.left, anchor.left), right: Math.max(bounds.right, anchor.right),
            top: Math.min(bounds.top, anchor.top), bottom: Math.max(bounds.bottom, anchor.bottom) };
      callout.draw(p, viewport, bounds, labels);
    }
  }
  dispose() {
    this.svg.replaceChildren();
  }
}
