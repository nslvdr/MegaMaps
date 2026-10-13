import type { Point, Size } from "./camera";
import { CalloutLayout, leader, type CalloutBounds, type CalloutPlacement } from "./callout-layout";
export type { CalloutBounds } from "./callout-layout";

const NS = "http://www.w3.org/2000/svg";
const node = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS(NS, tag);

// Labels are measured on a canvas: asking SVG text for its length forces a
// layout, and a search revealing thousands of labels at once froze the map for
// most of a second. Labels share one font, read from the first one shown.
let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: SVGTextElement) {
  if (measurer === undefined && text.isConnected) {
    measurer = document.createElement("canvas").getContext?.("2d") ?? null;
    if (measurer) {
      const style = getComputedStyle(text);
      measurer.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    }
  }
  return measurer?.measureText(text.textContent!).width ||
    text.getComputedTextLength?.() || Array.from(text.textContent!).length * 8;
}

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
  private anchor?: Point;
  // What the layout moved and the label has yet to cover, relative to its
  // anchor: it glides to new spots rather than jumping there.
  private drift = { x: 0, y: 0 };
  private drawn = 0;
  private shown?: CalloutBounds;
  private resumed = false;

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

  /** Where the chip sits on screen, while it is shown. */
  get bounds() {
    return this.element.hasAttribute("hidden") ? undefined : this.shown;
  }

  /** Takes over where a callout for the same item was, when overlays rebuild. */
  follow(previous: MapCallout) {
    this.placement = previous.placement;
    this.anchor = previous.anchor;
    this.drift = previous.drift;
    this.drawn = previous.drawn;
    this.resumed = !previous.element.hasAttribute("hidden");
  }

  setText(text: string) {
    this.fullText = text;
  }

  // One straight segment ends at the target's nearest edge, without a dot.
  // Returns whether the label is still gliding and needs another frame.
  draw(anchor: Point, viewport: Size, bounds: CalloutBounds = {
    left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y,
  }, layout = new CalloutLayout(viewport)): boolean {
    const appearing = this.element.hasAttribute("hidden") && !this.resumed;
    this.resumed = false;
    const outside = bounds.right < 0 || bounds.bottom < 0 ||
      bounds.left > viewport.width || bounds.top > viewport.height;
    this.element.toggleAttribute("hidden", outside);
    if (outside) return false;
    const maxWidth = Math.max(60, Math.min(288, viewport.width - 16));
    if (this.fullText !== this.measuredText || maxWidth !== this.maxWidth) {
      this.measuredText = this.fullText;
      this.maxWidth = maxWidth;
      const characters = Array.from(this.fullText);
      const maxCharacters = Math.max(1, Math.floor((maxWidth - 51) / 8));
      this.text.textContent = characters.length > maxCharacters
        ? `${characters.slice(0, maxCharacters - 1).join("")}…` : this.fullText;
      const measure = () => textWidth(this.text);
      while (Array.from(this.text.textContent!).length > 1 && measure() > maxWidth - 51)
        this.text.textContent = `${Array.from(this.text.textContent!).slice(0, -2).join("")}…`;
      this.width = Math.min(maxWidth, Math.ceil(measure()) + 51);
      this.background.setAttribute("width", String(this.width));
    }
    const placement = layout.place({ width: this.width, height: 36 }, bounds, anchor, this.placement);
    this.element.toggleAttribute("hidden", !placement);
    if (!placement) return false;
    const now = performance.now(), previous = this.placement;
    const decay = Math.exp(-(now - this.drawn) / 90);
    let dx = appearing ? 0 : this.drift.x * decay, dy = appearing ? 0 : this.drift.y * decay;
    // Panning keeps a spot; only a new one is glided to, from where it was shown.
    if (!appearing && previous && this.anchor && (previous.direction !== placement.direction ||
        previous.gap !== placement.gap || previous.shift !== placement.shift)) {
      dx += previous.bounds.left - this.anchor.x - placement.bounds.left + anchor.x;
      dy += previous.bounds.top - this.anchor.y - placement.bounds.top + anchor.y;
    }
    if (Math.hypot(dx, dy) < 0.5) dx = dy = 0;
    this.drift = { x: dx, y: dy };
    this.drawn = now;
    this.placement = placement;
    this.anchor = anchor;
    const shown = this.shown = dx || dy ? {
      left: placement.bounds.left + dx, right: placement.bounds.right + dx,
      top: placement.bounds.top + dy, bottom: placement.bounds.bottom + dy,
    } : placement.bounds;
    const { from, to } = shown === placement.bounds ? placement : leader(shown, bounds);
    const { left: x, top: y } = shown;
    this.element.setAttribute("transform", `translate(${x},${y})`);
    this.connector.setAttribute("x1", String(from.x - x));
    this.connector.setAttribute("y1", String(from.y - y));
    this.connector.setAttribute("x2", String(to.x - x));
    this.connector.setAttribute("y2", String(to.y - y));
    return shown !== placement.bounds;
  }
}
