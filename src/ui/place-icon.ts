import { markerKinds, type MapMarker } from "../viewer/navigation";
import { CASING, glyphs } from "../viewer/overlays";

// The same pin as on the map, so a place kind is recognizable at a glance.
export const placeIcon = (kind: MapMarker["kind"]) => {
  const { color } = markerKinds[kind] ?? markerKinds.landmark;
  const glyph = glyphs[kind] ?? glyphs.landmark;
  return `<svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="11" fill="${color}"/><path d="${glyph.d}" fill="${glyph.fill ? CASING : "none"}" stroke="${CASING}" stroke-width="${glyph.fill ? 0.8 : 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};
