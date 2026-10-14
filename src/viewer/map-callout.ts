import type { Point, Size as Viewport } from "./camera";
import { CalloutLayout, leader, type CalloutBounds } from "./callout-layout";
export type { CalloutBounds } from "./callout-layout";

const NS = "http://www.w3.org/2000/svg";
const FADE = 180;
const node = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS(NS, tag);

// Large labels (Settings) grow the whole chip with their text. `padding` is
// the chip's width besides its text; `character` estimates a letter's width.
const sizes = {
  standard: { height: 36, radius: 12, icon: 16, iconX: 12, textX: 38, baseline: 23, padding: 51, character: 8 },
  large: { height: 40, radius: 14, icon: 18, iconX: 12, textX: 41, baseline: 26, padding: 55, character: 9 },
};
type Size = typeof sizes.standard;

// Labels are measured on a canvas: asking SVG text for its length forces a
// layout, and a search revealing thousands of labels at once froze the map for
// most of a second. Labels of a size share one font, read from the first shown.
const measurers = new Map<Size, CanvasRenderingContext2D | null>();
function textWidth(text: SVGTextElement, size: Size) {
  if (!measurers.has(size) && text.isConnected) {
    const measurer = document.createElement("canvas").getContext?.("2d") ?? null;
    if (measurer) {
      const style = getComputedStyle(text);
      measurer.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    }
    measurers.set(size, measurer);
  }
  return measurers.get(size)?.measureText(text.textContent!).width ||
    text.getComputedTextLength?.() || Array.from(text.textContent!).length * size.character;
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
  // Where the label's spot sits from its anchor, and what the layout moved
  // that it has yet to cover: it glides to new spots rather than jumping.
  private spot = { x: 0, y: 0 };
  private drift = { x: 0, y: 0 };
  private opacity = 0;
  private drawn = 0;
  private shown?: CalloutBounds;
  private placed = false;
  private size = sizes[document.documentElement.dataset.labels === "large" ? "large" : "standard"];

  constructor(iconMarkup: string, color = "var(--neon-saved)") {
    this.element.setAttribute("class", "map-callout");
    this.element.style.setProperty("--callout-color", color);
    this.connector.setAttribute("class", "map-callout-connector");
    const size = this.size;
    this.background.setAttribute("height", String(size.height));
    this.background.setAttribute("rx", String(size.radius));
    const icon = node("g");
    icon.innerHTML = iconMarkup;
    const symbol = icon.querySelector("svg")!;
    symbol.setAttribute("class", "map-callout-icon");
    symbol.setAttribute("x", String(size.iconX));
    symbol.setAttribute("y", String((size.height - size.icon) / 2));
    symbol.setAttribute("width", String(size.icon));
    symbol.setAttribute("height", String(size.icon));
    this.text.setAttribute("x", String(size.textX));
    this.text.setAttribute("y", String(size.baseline));
    this.element.append(this.connector, this.background, icon, this.text);
    this.element.setAttribute("hidden", "");
  }

  /** Where the chip sits on screen, while it has a spot. */
  get bounds() {
    return this.placed ? this.shown : undefined;
  }

  /** Takes over where a callout for the same item was, when overlays rebuild. */
  follow(previous: MapCallout) {
    this.spot = previous.spot;
    this.drift = previous.drift;
    this.opacity = previous.opacity;
    this.drawn = previous.drawn;
  }

  /** Hides at once, for labels the user turned off. */
  hide() {
    this.element.setAttribute("hidden", "");
    this.opacity = 0;
    this.placed = false;
  }

  setText(text: string) {
    this.fullText = text;
  }

  // One straight segment ends at the target's nearest edge, without a dot.
  // Labels fade out when they leave the screen or lose their spot, following
  // their anchor meanwhile, and fade in where they arrive. Returns whether the
  // label is still moving or fading and needs another frame. One not `wanted`
  // fades out the same way.
  draw(anchor: Point, viewport: Viewport, bounds: CalloutBounds = {
    left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y,
  }, layout = new CalloutLayout(viewport), wanted = true): boolean {
    const away = !wanted || bounds.right < 0 || bounds.bottom < 0 ||
      bounds.left > viewport.width || bounds.top > viewport.height;
    if (away && !this.opacity) return false;
    const placement = away ? undefined : layout.place(this.measure(viewport), bounds, anchor);
    const now = performance.now(), elapsed = now - this.drawn;
    const decay = Math.exp(-elapsed / 90);
    let dx = this.drift.x * decay, dy = this.drift.y * decay;
    if (placement) {
      const spot = { x: placement.bounds.left - anchor.x, y: placement.bounds.top - anchor.y };
      // A label that appears starts at its spot; one already shown glides there.
      if (this.opacity) {
        dx += this.spot.x - spot.x;
        dy += this.spot.y - spot.y;
      } else dx = dy = 0;
      this.spot = spot;
    }
    if (Math.hypot(dx, dy) < 0.5) dx = dy = 0;
    // One that appears fades in from its first frame, however long it was hidden.
    const step = (this.opacity ? elapsed : 16) / FADE;
    this.opacity = Math.max(0, Math.min(1, this.opacity + (placement ? step : -step)));
    this.drift = { x: dx, y: dy };
    this.drawn = now;
    this.placed = !!placement;
    if (!this.opacity) {
      this.hide();
      return false;
    }
    this.element.removeAttribute("hidden");
    this.element.style.opacity = this.opacity < 1 ? String(this.opacity) : "";
    const x = anchor.x + this.spot.x + dx, y = anchor.y + this.spot.y + dy;
    const shown = this.shown = { left: x, right: x + this.width, top: y, bottom: y + this.size.height };
    const { from, to } = leader(shown, bounds);
    this.element.setAttribute("transform", `translate(${x},${y})`);
    this.connector.setAttribute("x1", String(from.x - x));
    this.connector.setAttribute("y1", String(from.y - y));
    this.connector.setAttribute("x2", String(to.x - x));
    this.connector.setAttribute("y2", String(to.y - y));
    return !!(dx || dy) || this.opacity < 1;
  }

  // Fits the text to the screen once per text and screen width.
  private measure(viewport: Viewport) {
    const maxWidth = Math.max(60, Math.min(288, viewport.width - 16));
    if (this.fullText !== this.measuredText || maxWidth !== this.maxWidth) {
      this.measuredText = this.fullText;
      this.maxWidth = maxWidth;
      const { padding, character } = this.size;
      const characters = Array.from(this.fullText);
      const maxCharacters = Math.max(1, Math.floor((maxWidth - padding) / character));
      this.text.textContent = characters.length > maxCharacters
        ? `${characters.slice(0, maxCharacters - 1).join("")}…` : this.fullText;
      const measure = () => textWidth(this.text, this.size);
      while (Array.from(this.text.textContent!).length > 1 && measure() > maxWidth - padding)
        this.text.textContent = `${Array.from(this.text.textContent!).slice(0, -2).join("")}…`;
      this.width = Math.min(maxWidth, Math.ceil(measure()) + padding);
      this.background.setAttribute("width", String(this.width));
    }
    return { width: this.width, height: this.size.height };
  }
}
