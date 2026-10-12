import { markerKinds, type MapMarker } from "../viewer/navigation";
import { lucideMarkup, placeSymbols } from "./icons";

export const PIN_CASING = "#05070a";

// The same pin as on the map, so a place kind is recognizable at a glance.
export const placeIcon = (kind: MapMarker["kind"]) => {
  const { color } = markerKinds[kind] ?? markerKinds.landmark;
  const symbol = placeSymbols[kind] ?? placeSymbols.landmark;
  return `<svg class="place-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${color}" stroke="${PIN_CASING}" stroke-width="2.5"/><g class="place-glyph" transform="translate(4 4) scale(0.6666666667)" fill="none" stroke="${PIN_CASING}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${lucideMarkup(symbol)}</g></svg>`;
};
