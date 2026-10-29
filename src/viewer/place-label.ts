import type { Point, Size } from "./camera";
import type { CalloutBounds, CalloutLayout } from "./callout-layout";
import { PIN_CASING, PLACE_PIN, waterColors } from "../ui/place-icon";
import { markerCalloutIcon } from "../ui/icons";
import { placeColor, type MapMarker } from "./navigation";

const NS = "http://www.w3.org/2000/svg";
/** The spring between pin (0) and open balloon (1): it opens in about a third
 * of a second with a slight overshoot, and closes as quickly. */
const STIFFNESS = 320, DAMPING = 25;
/** The teardrop head's radius and its casing, in the same units as PLACE_PIN. */
const HEAD_RADIUS = 10.5, CASING = 1.15;
/** As `body` in style.css: labels are measured before they're on screen. */
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CHIP = "#080c0c";
/** How far the balloon's body stands off its place, along its tail, and
 * half the tail's width where it leaves the body. */
const TAIL = 12, TAIL_WIDTH = 8;
/** The sides a balloon can open to, in order of preference: unit steps from the place. */
const SIDES = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }] as const;
type Side = (typeof SIDES)[number];
let clips = 0;

let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number) {
  measurer ??= document.createElement("canvas").getContext?.("2d") ?? null;
  if (!measurer) return Array.from(text).length * size * 0.56;
  measurer.font = `600 ${size}px ${FONT}`;
  return measurer.measureText(text).width;
}
/** The text as it fits in `max` pixels, and its width. */
function fit(text: string, size: number, max: number) {
  let shown = text, width = textWidth(shown, size);
  while (width > max && Array.from(shown).length > 1) {
    shown = `${Array.from(shown).slice(0, -2).join("")}…`;
    width = textWidth(shown, size);
  }
  return { text: shown, width: Math.ceil(width) };
}
const set = (element: Element, attributes: Record<string, number | string>) => {
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, typeof value === "number" ? value.toFixed(2) : value);
};

/** A place's name in a balloon that grows out of its pin: its tail ends on
 * the place and its head holds the symbol. It opens above or below its place,
 * or else to the right or the left. Names only ever use textContent. */
export class PlaceLabel {
  readonly element = document.createElementNS(NS, "g");
  private parts: Record<"textClip" | "casing" | "outline" | "fill" | "head" | "text" | "tip", SVGElement> &
    Partial<Record<"headClip" | "water" | "icon", SVGElement>>;
  private name = "";
  private size?: { raised: boolean; max: number; text: string; textSize: number; width: number; height: number };
  private shown?: CalloutBounds;
  private open = 0;
  /** The side it took, while open. */
  private side?: Side;
  private speed = 0;
  private drawn = 0;
  private rendered = "";

  /** `pin` is the place's pin, which the balloon takes the place of while open. */
  constructor(private place: Pick<MapMarker, "kind" | "water" | "danger">, private pin?: SVGElement) {
    const color = placeColor(place), id = ++clips;
    const water = place.kind === "flooded" && place.water
      ? `<clipPath id="place-label-head-${id}"><circle/></clipPath><rect class="water" clip-path="url(#place-label-head-${id})" fill="${waterColors[place.water]}"/>`
      : "";
    this.element.setAttribute("class", "place-label");
    // The body pulses with its pin when the place is found (see .found in style.css).
    this.element.innerHTML = `<g class="place-label-body"><clipPath id="place-label-text-${id}"><rect/></clipPath><path class="casing" fill="${PIN_CASING}" stroke="${PIN_CASING}" stroke-width="7" stroke-linejoin="round"/><path class="outline" fill="${color}" stroke="${color}" stroke-width="3" stroke-linejoin="round"/><path class="fill" fill="${CHIP}"/><circle class="head" fill="${color}"/>${water}${markerCalloutIcon(place.kind)}<text clip-path="url(#place-label-text-${id})" font-weight="600"/><circle class="tip" fill="${color}" stroke="${PIN_CASING}" stroke-width="2"/></g>`;
    const part = (selector: string) => this.element.querySelector<SVGElement>(selector) ?? undefined;
    this.parts = {
      textClip: part("clipPath rect")!, casing: part(".casing")!, outline: part(".outline")!, fill: part(".fill")!,
      head: part(".head")!, text: part("text")!, tip: part(".tip")!,
      headClip: part("clipPath circle"), water: part(".water"), icon: part("svg"),
    };
    this.parts.icon?.style.setProperty("color", PIN_CASING);
    this.parts.icon?.setAttribute("stroke-width", "2.5");
    this.element.setAttribute("hidden", "");
  }

  /** Where the balloon sits on screen, while it is open. */
  get bounds() {
    return this.shown;
  }

  /** Whether it is open, or growing or shrinking. */
  get opened() {
    return this.open > 0;
  }

  /** Takes over a balloon for the same place, when overlays rebuild. */
  follow(previous: unknown) {
    if (!(previous instanceof PlaceLabel)) return;
    this.open = previous.open;
    this.side = previous.side;
    this.speed = previous.speed;
    this.drawn = previous.drawn;
  }

  setText(text: string) {
    this.name = text;
    this.size = undefined;
  }

  hide() {
    this.element.setAttribute("hidden", "");
    this.open = this.speed = 0;
    this.side = this.shown = undefined;
    if (this.pin) this.pin.style.opacity = "";
  }

  /** Draws the balloon at its pin's tip; returns whether it is still growing
   * or shrinking. `own` are the symbols at its tip, such as its pin, which it may cover. */
  draw(tip: Point, viewport: Size, layout: CalloutLayout, wanted: boolean, raised: boolean, own: CalloutBounds[]) {
    const away = !wanted || tip.x < -40 || tip.y < -40 || tip.x > viewport.width + 40 || tip.y > viewport.height + 60;
    if (away && !this.open) return false;
    const size = this.measure(raised, Math.max(60, Math.min(220, viewport.width - 120)));
    // The body, and the tail's narrow strip between it and the place.
    const room = (side: Side) => {
      const x = tip.x + side.x * (TAIL + size.width / 2), y = tip.y + side.y * (TAIL + size.height / 2);
      const across = side.x ? { x: 0, y: TAIL_WIDTH } : { x: TAIL_WIDTH, y: 0 }, end = { x: tip.x + side.x * TAIL, y: tip.y + side.y * TAIL };
      return [
        { left: x - size.width / 2, right: x + size.width / 2, top: y - size.height / 2, bottom: y + size.height / 2 },
        { left: Math.min(tip.x, end.x) - across.x, right: Math.max(tip.x, end.x) + across.x,
          top: Math.min(tip.y, end.y) - across.y, bottom: Math.max(tip.y, end.y) + across.y },
      ] as const;
    };
    // Whether at least half the body is on screen.
    const showing = (side: Side) => {
      const [body] = room(side);
      const seen = Math.max(0, Math.min(body.right, viewport.width) - Math.max(body.left, 0)) *
        Math.max(0, Math.min(body.bottom, viewport.height) - Math.max(body.top, 0));
      return seen * 2 >= (body.right - body.left) * (body.bottom - body.top);
    };
    // A closed balloon opens on the first free side, fully on screen if it can,
    // else at least half on screen. Open, it keeps that side, even when a better
    // one frees up or a pan takes it past the screen's edge. When the side is
    // taken, it shrinks back into its pin, still holding its spot, and then opens again.
    const kept = this.open ? this.side : undefined;
    this.side = kept ?? SIDES.find(side => layout.claim(room(side), own))
      ?? SIDES.find(side => showing(side) && layout.claim(room(side), own, false));
    const claimed = !away && !!this.side && (!kept || layout.claim(room(kept), own, false)), target = claimed ? 1 : 0;
    if (kept && !claimed && !away) for (const spot of room(kept)) layout.addObstacle(spot);
    const now = performance.now();
    // Small steps keep the spring steady through a slow frame; a long pause just settles it.
    for (let left = this.open || this.speed ? Math.min(0.5, (now - this.drawn) / 1000) : 1 / 60; left > 0; left -= 1 / 120) {
      const step = Math.min(left, 1 / 120);
      this.speed += (STIFFNESS * (target - this.open) - DAMPING * this.speed) * step;
      this.open += this.speed * step;
    }
    this.drawn = now;
    if (Math.abs(target - this.open) < 0.002 && Math.abs(this.speed) < 0.02) {
      this.open = target;
      this.speed = 0;
    }
    const side = this.side;
    if (this.open <= 0 || !side) {
      this.hide();
      // Closing frees its spot: one more frame lets a balloon waiting for it open.
      return !!kept;
    }
    if (claimed) {
      const [body, tail] = room(side);
      this.shown = { left: Math.min(body.left, tail.left), right: Math.max(body.right, tail.right),
        top: Math.min(body.top, tail.top), bottom: Math.max(body.bottom, tail.bottom) };
    } else this.shown = undefined;
    this.element.removeAttribute("hidden");
    this.element.setAttribute("transform", `translate(${tip.x.toFixed(1)},${tip.y.toFixed(1)})`);
    // The pin hands over to the balloon early, while both are still the same shape.
    const handover = Math.min(1, this.open * 4);
    this.element.style.opacity = handover < 1 ? String(handover) : "";
    if (this.pin) this.pin.style.opacity = handover > 0 ? String(1 - handover) : "";
    this.render(this.open, side, raised ? 1.5 : 1, size);
    return this.open !== target;
  }

  // The shape between a round head (0), a pin's head swung to the balloon's
  // side, and the open balloon (1).
  private render(open: number, side: Side, scale: number, size: NonNullable<PlaceLabel["size"]>) {
    const key = `${open.toFixed(3)} ${side.x} ${side.y} ${scale} ${size.width} ${size.height} ${size.text}`;
    if (key === this.rendered) return;
    this.rendered = key;
    const between = (from: number, to: number) => from + (to - from) * open;
    const start = (HEAD_RADIUS + CASING) * scale;
    const half = between(start, size.height / 2), width = between(start * 2, size.width);
    // How far the body's center is from the place, along the tail.
    const reach = between(PLACE_PIN.head * scale, TAIL + (side.x ? size.width : size.height) / 2);
    const cx = side.x * reach, cy = side.y * reach;
    const left = cx - width / 2, top = cy - half, flat = width / 2 - half;
    const head = { x: left + half, y: cy, r: Math.max(0, between((HEAD_RADIUS - CASING) * scale, size.height / 2 - 4)) };
    const { textClip, casing, outline, fill, head: disc, text, tip, headClip, water, icon } = this.parts;
    // The tail runs from inside the body to the place, in the place's colour
    // like its pin; the body's dark fill is drawn over the outline, so only
    // the outline's outer edge shows around it. A dark casing goes around both,
    // and a dot marks the place, so the tail's point shows on any map.
    const base = reach - (side.x ? flat + Math.sqrt(Math.max(0, half ** 2 - TAIL_WIDTH ** 2))
      : TAIL_WIDTH <= flat ? half : Math.sqrt(Math.max(0, half ** 2 - (TAIL_WIDTH - flat) ** 2)));
    const at = (across: number, along: number) =>
      `${(side.x * along - side.y * across).toFixed(2)} ${(side.y * along + side.x * across).toFixed(2)}`;
    const [l, r, t, b, h] = [left + half, left + width - half, top, top + half * 2, half].map(value => value.toFixed(2));
    const body = `M${l} ${b}A${h} ${h} 0 0 1 ${l} ${t}H${r}A${h} ${h} 0 0 1 ${r} ${b}Z`, w = TAIL_WIDTH;
    const shape = `${body}M${at(w, reach)}L${at(w, base)}C${at(w * 0.85, base - 3)} ${at(2.5, 3)} 0 0` +
      `C${at(-2.5, 3)} ${at(-w * 0.85, base - 3)} ${at(-w, base)}L${at(-w, reach)}Z`;
    set(casing, { d: shape });
    set(outline, { d: shape });
    set(fill, { d: body });
    set(tip, { r: 4 * scale * Math.min(1, open) });
    set(disc, { cx: head.x, cy: head.y, r: head.r });
    if (headClip) set(headClip, { cx: head.x, cy: head.y, r: head.r });
    if (water && this.place.water) {
      const surface = head.y + head.r - head.r * 2 * this.place.water / 3.4;
      set(water, { x: head.x - head.r, y: surface, width: head.r * 2, height: head.y + head.r - surface });
    }
    if (icon) set(icon, { x: head.x - head.r * 0.62, y: head.y - head.r * 0.62, width: head.r * 1.24, height: head.r * 1.24 });
    set(text, { x: left + half * 2 + 4, y: head.y + size.textSize * 0.35, "font-size": size.textSize });
    text.textContent = size.text;
    // The name shows as the balloon opens past it, inside its edge.
    text.style.opacity = String(Math.max(0, Math.min(1, (open - 0.3) / 0.6)));
    set(textClip, { x: left, y: top, width, height: half * 2 });
  }

  // The open balloon's size, measured once per text, size and screen width.
  private measure(raised: boolean, max: number) {
    if (this.size?.raised !== raised || this.size.max !== max) {
      const textSize = raised || document.documentElement.dataset.labels === "large" ? 16 : 14;
      const text = fit(this.name, textSize, max), height = raised ? 36 : 30;
      this.size = { raised, max, text: text.text, textSize, width: height + text.width + 14, height };
    }
    return this.size;
  }
}
