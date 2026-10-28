import { placeColor, type MapMarker, type WaterLevel } from "../viewer/navigation";
import { lucideMarkup, placeSymbols } from "./icons";

export const PIN_CASING = "#05070a";

// A teardrop whose tip is the place: its 24-unit head sits above the spot, so
// the pin never hides what it marks. The square box is drawn at `size` pixels
// with `tip` on the place; the head's centre is `head` pixels above it.
export const PLACE_PIN = { size: 32, tip: { x: 16, y: 31 }, head: 18 } as const;
const TEARDROP = "M12 30C9.5 25 1.5 19.5 1.5 12a10.5 10.5 0 0 1 21 0C22.5 19.5 14.5 25 12 30Z";

// Flooded pins with a level fill with water from the tip: a third, two thirds,
// or nearly full, warming from green to red as the water gets deeper.
export const waterColors = { 1: "#7dff8a", 2: "#ffd23f", 3: "#ff4d4d" } as const;
const waterTops = { 1: 21, 2: 14.5, 3: 7.5 } as const;
// Each pin clips its own water, so a hidden copy elsewhere never takes it away.
let waterClips = 0;
const water = (level: WaterLevel) => {
  const id = `place-water-${++waterClips}`;
  return `<clipPath id="${id}"><path d="${TEARDROP}"/></clipPath><path class="water-gauge" clip-path="url(#${id})" d="M0 ${waterTops[level]}q3-1.6 6 0t6 0 6 0 6 0V32H0Z" fill="${waterColors[level]}"/>`;
};

// The same pin as on the map, so a place kind is recognizable at a glance.
// The glyph fills about half the head, so even square symbols clear its rim.
// Water draws under the outline; moderate danger is orange.
export const placeIcon = (kind: MapMarker["kind"], { water: level, danger }: Pick<MapMarker, "water" | "danger"> = {}) => {
  const color = placeColor({ kind, danger });
  const symbol = placeSymbols[kind] ?? placeSymbols.landmark;
  const outline = `stroke="${PIN_CASING}" stroke-width="2.3" stroke-linejoin="round"`;
  const flood = level && kind === "flooded" ? `${water(level)}<path d="${TEARDROP}" fill="none" ${outline}/>` : "";
  return `<svg class="place-icon" viewBox="-4 -1 32 32" aria-hidden="true"><path class="place-pin" d="${TEARDROP}" fill="${color}" ${outline}/>${flood}<g class="place-glyph" transform="translate(5.9 5.5) scale(0.51)" fill="none" stroke="${PIN_CASING}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${lucideMarkup(symbol)}</g></svg>`;
};
