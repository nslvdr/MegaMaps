import { markerKinds, type MapMarker, type WaterLevel } from "../viewer/navigation";
import { lucideMarkup, placeSymbols } from "./icons";

export const PIN_CASING = "#05070a";

// Flooded pins with a level grow a wider black rim holding three separate
// thirds, one per step: from the bottom up the right, over the top, then down
// the left. They warm from green to red as the water gets deeper.
export const waterColors = { 1: "#7dff8a", 2: "#ffd23f", 3: "#ff4d4d" } as const;
const WATER_RIM = 16;
const waterGauge = (water: WaterLevel) => {
  // Centred in the black band, from the disc's inner stroke edge (9.5) to the rim.
  const radius = 12.75, gap = 13;
  const at = (degrees: number) => {
    const angle = degrees * Math.PI / 180;
    return `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`;
  };
  // SVG angles grow clockwise from the right, so 90° is the bottom.
  const thirds = Array.from({ length: water }, (_, i) =>
    `M${at(90 - i * 120 - gap)}A${radius} ${radius} 0 0 0 ${at(90 - (i + 1) * 120 + gap)}`).join("");
  return `<path class="water-gauge" d="${thirds}" fill="none" stroke="${waterColors[water]}" stroke-width="2.4" stroke-linecap="round"/>`;
};

// The same pin as on the map, so a place kind is recognizable at a glance.
// The glyph fills about half the disc, so even square symbols clear its rim.
// A water rim draws just outside the 24-unit box.
export const placeIcon = (kind: MapMarker["kind"], water?: WaterLevel) => {
  const { color } = markerKinds[kind] ?? markerKinds.landmark;
  const symbol = placeSymbols[kind] ?? placeSymbols.landmark;
  const gauge = water && kind === "flooded" ? waterGauge(water) : "";
  return `<svg class="place-icon" viewBox="0 0 24 24"${gauge ? ' overflow="visible"' : ""} aria-hidden="true">${gauge ? `<circle cx="12" cy="12" r="${WATER_RIM}" fill="${PIN_CASING}"/>` : ""}<circle cx="12" cy="12" r="10.75" fill="${color}" stroke="${PIN_CASING}" stroke-width="2.5"/><g class="place-glyph" transform="translate(5.4 5.4) scale(0.55)" fill="none" stroke="${PIN_CASING}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${lucideMarkup(symbol)}</g>${gauge}</svg>`;
};
