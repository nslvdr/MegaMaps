import type { Point, Size } from "./camera";
import { CalloutLayout, type CalloutBounds, type CalloutPlacement } from "./callout-layout";
export type { CalloutBounds } from "./callout-layout";

const NS = "http://www.w3.org/2000/svg";
const node = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS(NS, tag);

// Shared screen-space labels for detected text, saved places, and routes.
// Icon markup comes from app-owned symbols; user names only use textContent.
export class MapCallout {
  readonly element = node("g");
  private connector = node("line");
  private background = node("rect");
  private text = node("text");
  private fullText = "";
  private measuredText = "";
  private maxWidth = 0;
  private width = 0;
  private placement?: CalloutPlacement;

  constructor(iconMarkup: string, color = "var(--neon-saved)") {
    this.element.setAttribute("class", "map-callout");
    this.element.style.setProperty("--callout-color", color);
    this.connector.setAttribute("class", "map-callout-connector");
    this.background.setAttribute("height", "36");
    this.background.setAttribute("rx", "12");
    const icon = node("g");
    icon.innerHTML = iconMarkup;
    const symbol = icon.querySelector("svg")!;
    symbol.setAttribute("class", "map-callout-icon");
    symbol.setAttribute("x", "12");
    symbol.setAttribute("y", "10");
    symbol.setAttribute("width", "16");
    symbol.setAttribute("height", "16");
    this.text.setAttribute("x", "38");
    this.text.setAttribute("y", "23");
    this.element.append(this.connector, this.background, icon, this.text);
    this.element.setAttribute("hidden", "");
  }

  setText(text: string) {
    this.fullText = text;
  }

  // One straight segment ends at the target's nearest edge, without a dot.
  draw(anchor: Point, viewport: Size, bounds: CalloutBounds = {
    left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y,
  }, layout = new CalloutLayout(viewport)) {
    const outside = bounds.right < 0 || bounds.bottom < 0 ||
      bounds.left > viewport.width || bounds.top > viewport.height;
    this.element.toggleAttribute("hidden", outside);
    if (outside) return;
    const maxWidth = Math.max(60, Math.min(288, viewport.width - 16));
    if (this.fullText !== this.measuredText || maxWidth !== this.maxWidth) {
      this.measuredText = this.fullText;
      this.maxWidth = maxWidth;
      const characters = Array.from(this.fullText);
      const maxCharacters = Math.max(1, Math.floor((maxWidth - 51) / 8));
      this.text.textContent = characters.length > maxCharacters
        ? `${characters.slice(0, maxCharacters - 1).join("")}…` : this.fullText;
      const measure = () => this.text.getComputedTextLength?.() || Array.from(this.text.textContent!).length * 8;
      while (Array.from(this.text.textContent!).length > 1 && measure() > maxWidth - 51)
        this.text.textContent = `${Array.from(this.text.textContent!).slice(0, -2).join("")}…`;
      this.width = Math.min(maxWidth, Math.ceil(measure()) + 51);
      this.background.setAttribute("width", String(this.width));
    }
    const placement = layout.place({ width: this.width, height: 36 }, bounds, anchor, this.placement);
    this.element.toggleAttribute("hidden", !placement);
    if (!placement) return;
    this.placement = placement;
    const { left: x, top: y } = placement.bounds;
    this.element.setAttribute("transform", `translate(${x},${y})`);
    this.connector.setAttribute("x1", String(placement.from.x - x));
    this.connector.setAttribute("y1", String(placement.from.y - y));
    this.connector.setAttribute("x2", String(placement.to.x - x));
    this.connector.setAttribute("y2", String(placement.to.y - y));
  }
}
