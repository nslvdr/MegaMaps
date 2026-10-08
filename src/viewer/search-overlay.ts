import { worldToScreen, type Camera, type Size } from "./camera";
import type { MapSearchMatch } from "./map-search";
import { markerKinds } from "./navigation";
import { markerCalloutIcon } from "./overlays";
import { icons } from "../ui/icons";
import { MapCallout } from "./map-callout";
import { CalloutLayout } from "./callout-layout";

const NS = "http://www.w3.org/2000/svg";

// Project place symbols at a fixed screen size and detected text at its map size.
const project = (match: MapSearchMatch, camera: Camera) => {
  const polygons = match.polygons.map(polygon => polygon.map(point => worldToScreen(camera, point)));
  const point = match.marker && worldToScreen(camera, match.marker.point);
  const points = point ? [{ x: point.x - 12, y: point.y - 12 }, { x: point.x + 12, y: point.y + 12 }] : polygons.flat();
  if (!points.length) return undefined;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const bounds = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  return { polygons, bounds, anchor: { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } };
};

// Every match gets a callout; screen-space layout stays legible while exploring.
export class SearchOverlay {
  private matches: MapSearchMatch[] = [];
  private holes: SVGPolygonElement[][] = [];
  private placeHoles: (SVGCircleElement | undefined)[] = [];
  private highlights: SVGGElement[] = [];
  private callouts: MapCallout[] = [];
  private active = false;
  private selected = 0;
  constructor(private svg: SVGSVGElement) {
    svg.innerHTML =
      '<defs><mask id="map-search-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/></mask></defs><rect width="100%" height="100%" fill="black" fill-opacity="0.55" mask="url(#map-search-mask)"/><g class="search-highlights"></g>';
    svg.setAttribute("hidden", "");
  }
  set(matches: MapSearchMatch[], active: boolean, selected = 0) {
    this.active = active;
    this.selected = selected;
    this.svg.toggleAttribute("hidden", !active);
    // Result navigation changes emphasis without rebuilding every polygon or label.
    if (matches === this.matches) return;
    this.matches = matches;
    for (const hole of this.holes.flat()) hole.remove();
    for (const hole of this.placeHoles) hole?.remove();
    const mask = this.svg.querySelector("mask")!;
    this.holes = matches.map(match => match.polygons.map(() => {
      const polygon = document.createElementNS(NS, "polygon");
      polygon.setAttribute("fill", "black");
      polygon.setAttribute("stroke", "black");
      polygon.setAttribute("stroke-width", "6");
      polygon.setAttribute("stroke-linejoin", "round");
      mask.append(polygon);
      return polygon;
    }));
    this.placeHoles = matches.map(match => {
      if (!match.marker) return undefined;
      const hole = document.createElementNS(NS, "circle");
      hole.setAttribute("fill", "black");
      hole.setAttribute("r", "18");
      mask.append(hole);
      return hole;
    });
    const highlights = this.svg.querySelector(".search-highlights")!;
    highlights.replaceChildren();
    this.callouts = [];
    this.highlights = matches.map(match => {
      const group = document.createElementNS(NS, "g");
      group.setAttribute("class", "search-highlight");
      const connector = document.createElementNS(NS, "line");
      connector.setAttribute("class", "search-match-connector");
      const callout = new MapCallout(match.marker ? markerCalloutIcon(match.marker.kind) : icons.text,
        match.marker ? markerKinds[match.marker.kind].color : undefined);
      callout.setText(match.text);
      this.callouts.push(callout);
      group.append(connector, callout.element);
      highlights.append(group);
      return group;
    });
  }
  // Protect every target from both search and saved labels, regardless of selection.
  reserve(camera: Camera, layout: CalloutLayout) {
    if (!this.active) return;
    for (const match of this.matches) {
      const target = project(match, camera);
      if (target) layout.addObstacle(target.bounds);
    }
  }
  draw(camera: Camera, viewport: Size, layout?: CalloutLayout) {
    if (!this.active) return;
    const labels = layout ?? new CalloutLayout(viewport);
    if (!layout) this.reserve(camera, labels);
    this.svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    const mask = this.svg.querySelector("mask")!;
    for (const [name, value] of Object.entries({ x: 0, y: 0, width: viewport.width, height: viewport.height }))
      mask.setAttribute(name, String(value));
    // Prioritize the selected result, then use the remaining space for all other matches.
    const order = this.matches.map((_, index) => index);
    if (this.selected > 0 && this.selected < order.length)
      order.unshift(...order.splice(this.selected, 1));
    for (const index of order) {
      const target = project(this.matches[index]!, camera);
      const highlight = this.highlights[index]!;
      highlight.toggleAttribute("hidden", !target);
      const callout = this.callouts[index]!;
      const selected = index === this.selected;
      highlight.toggleAttribute("data-selected", selected);
      callout.element.classList.toggle("search-selected-label", selected);
      if (!target) continue;
      for (const [polygonIndex, polygon] of target.polygons.entries())
        this.holes[index]![polygonIndex]!.setAttribute("points", polygon.map(p => `${p.x},${p.y}`).join(" "));
      const hole = this.placeHoles[index];
      if (hole) {
        hole.setAttribute("cx", String(target.anchor.x));
        hole.setAttribute("cy", String(target.anchor.y));
      }
      callout.draw(target.anchor, viewport, target.bounds, labels);
      // Dense targets still have a visible locator when their callout cannot fit.
      const connector = highlight.querySelector("line")!;
      connector.toggleAttribute("hidden", !callout.element.hasAttribute("hidden"));
      connector.setAttribute("x1", String(target.anchor.x));
      connector.setAttribute("x2", String(target.anchor.x));
      connector.setAttribute("y1", String(target.bounds.top - 10));
      connector.setAttribute("y2", String(target.bounds.top));
    }
  }
  dispose() {
    this.svg.replaceChildren();
    this.svg.setAttribute("hidden", "");
  }
}
