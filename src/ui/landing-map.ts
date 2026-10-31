import { crossing, features, PLAN_DARK, planMarkup } from "../example/plan";
import { markerKinds, routeColors, type MapMarker } from "../viewer/navigation";
import { icons, markerCalloutIcon } from "./icons";
import { PIN_CASING, PLACE_PIN, placeIcon } from "./place-icon";

// The landing page's backdrop: the example map as the app shows it, darkened,
// with places and a route drawn over it by the app itself.
type Point = { x: number; y: number };

// App icons are sized and placed like the viewer's pins: centred, or a teardrop by its tip.
const placed = (markup: string, at: Point, size: number, extra = "", anchor = { x: size / 2, y: size / 2 }) =>
  markup.replace("<svg ", `<svg x="${at.x - anchor.x}" y="${at.y - anchor.y}" width="${size}" height="${size}" ${extra}`);

// A label as the viewer draws it: a chip with the kind's icon, tied to its pin.
function callout(name: string, icon: string, color: string, from: Point, left: number, top: number) {
  const width = name.length * 8 + 51;
  return `<g class="map-callout" style="--callout-color:${color}">
<line class="map-callout-connector" x1="${from.x}" y1="${from.y}" x2="${left + width / 2}" y2="${top + 18}"/>
<rect x="${left}" y="${top}" width="${width}" height="36" rx="12"/>${placed(icon, { x: left + 20, y: top + 18 }, 16, 'class="map-callout-icon" ')}
<text x="${left + 38}" y="${top + 23}">${name}</text></g>`;
}

function route(points: Point[], color = routeColors[0]!) {
  const d = `M${points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L")}`;
  const dots = points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${PIN_CASING}"/><circle cx="${p.x}" cy="${p.y}" r="2" fill="${color}"/>`).join("");
  return `<path d="${d}" fill="none" stroke="${PIN_CASING}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`
    + placed(icons.routeStart, points[0]!, 20, `fill="${color}" stroke="${PIN_CASING}" stroke-width="3.6" `)
    + placed(icons.routeEnd, points.at(-1)!, 20, `fill="${PIN_CASING}" stroke="${color}" stroke-width="3.6" `);
}

export function fakePlan() {
  const view = "400 330 340 700";
  const places: [MapMarker["kind"], string, Point, number, number][] = [
    ["entrance", "Entrée Ouest", crossing(-4, -9), 430, 392],
    ["graffiti", "Fresque du chat", crossing(2, -6), 552, 556],
    ["shaft", "Puits Lalande", features.airShaft, 414, 604],
    ["room", "Salle Z", features.salleZ, 606, 760],
    ["sculpture", "Le gardien", features.sculpture, 452, 800],
  ];
  const path = [crossing(-4, -9), crossing(-1, -9), crossing(-1, 1), crossing(2, 1)];
  return `<div class="landing-map" style="--plan-dark:${PLAN_DARK}" aria-hidden="true">${planMarkup(340, view).replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" ')}
<svg viewBox="${view}" preserveAspectRatio="xMidYMid slice">${route(path)}
${places.map(([kind, name, point, left, top]) => callout(name, markerCalloutIcon(kind), markerKinds[kind].color, point, left, top)).join("")}
${places.map(([kind, , point]) => placed(placeIcon(kind), point, PLACE_PIN.size, "", PLACE_PIN.tip)).join("")}</svg></div>`;
}
