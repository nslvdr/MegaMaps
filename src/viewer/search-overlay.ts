import { worldToScreen, type Camera, type Size } from "./camera";
import type { OcrMatch } from "../ocr/index";

const NS = "http://www.w3.org/2000/svg";

// An unfiltered screen-space mask keeps matching map pixels clear in dark mode.
export class SearchOverlay {
  private matches: OcrMatch[] = [];
  private holes: SVGPolygonElement[] = [];
  private active = false;
  constructor(private svg: SVGSVGElement) {
    svg.innerHTML =
      '<defs><mask id="map-search-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/></mask></defs><rect width="100%" height="100%" fill="black" fill-opacity="0.78" mask="url(#map-search-mask)"/>';
    svg.setAttribute("hidden", "");
  }
  set(matches: OcrMatch[], active: boolean) {
    this.matches = matches;
    this.active = active;
    this.svg.toggleAttribute("hidden", !active);
    for (const hole of this.holes) hole.remove();
    const mask = this.svg.querySelector("mask")!;
    this.holes = matches
      .flatMap((match) => match.polygons)
      .map(() => {
        const polygon = document.createElementNS(NS, "polygon");
        polygon.setAttribute("fill", "black");
        polygon.setAttribute("stroke", "black");
        polygon.setAttribute("stroke-width", "6");
        polygon.setAttribute("stroke-linejoin", "round");
        mask.append(polygon);
        return polygon;
      });
  }
  draw(camera: Camera, viewport: Size) {
    if (!this.active) return;
    this.svg.setAttribute(
      "viewBox",
      `0 0 ${viewport.width} ${viewport.height}`,
    );
    const mask = this.svg.querySelector("mask")!;
    for (const [name, value] of Object.entries({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    }))
      mask.setAttribute(name, String(value));
    this.matches
      .flatMap((match) => match.polygons)
      .forEach((polygon, index) => {
        this.holes[index]!.setAttribute(
          "points",
          polygon
            .map((point) => {
              const p = worldToScreen(camera, point);
              return `${p.x},${p.y}`;
            })
            .join(" "),
        );
      });
  }
  dispose() {
    this.svg.replaceChildren();
    this.svg.setAttribute("hidden", "");
  }
}
