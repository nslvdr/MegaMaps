import { markerKinds, routeColors, type MapMarker } from "../viewer/navigation";
import { icons, markerCalloutIcon } from "./icons";
import { PIN_CASING, PLACE_PIN, placeIcon } from "./place-icon";

// A made-up cave survey as the app shows one: the scan, darkened, with
// places and a route drawn over it by the app itself.
type Point = { x: number; y: number };

const WIDTH = 400, HEIGHT = 860;

// Natural passages, each through the places it holds.
const passages = [
  "M-20 120C60 140 90 180 110 170S200 190 250 205S330 230 345 250S400 300 430 290",
  "M250 205C240 300 300 360 260 450S200 560 180 640",
  "M180 640C150 650 130 650 105 650",
  "M180 640C230 690 290 700 330 690S400 660 430 700",
  "M110 170C80 100 140 40 120 -20",
  "M345 250C330 150 380 80 360 -20",
  "M-20 420C60 400 120 480 260 450",
  "M105 650C60 720 40 780 -20 820",
  "M330 690C340 760 300 820 320 880",
];
const chambers = `<ellipse cx="105" cy="650" rx="58" ry="40"/><ellipse cx="300" cy="110" rx="40" ry="30"/>`;

// The scanned survey, inked in white once the app darkens it. Walls are drawn
// twice, wide then narrow in the background colour, to leave only their edges.
const walls = passages.map((d) => `<path d="${d}"/>`).join("") + chambers;
export const planScan = `<defs><filter id="plan-rough"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter></defs>
<g class="plan-cave" filter="url(#plan-rough)"><g class="cave-wall">${walls}</g><g class="cave-floor">${walls}</g></g>
<g class="plan-ink"><path class="survey" d="${passages.slice(0, 4).join("")}"/><text x="300" y="72">Salle ronde</text><text x="40" y="560" transform="rotate(-70 40 560)">Siphon</text></g>`;

// App icons are sized and placed like the viewer's pins: centred, or a teardrop by its tip.
export const placed = (markup: string, at: Point, size: number, extra = "", anchor = { x: size / 2, y: size / 2 }) =>
  markup.replace("<svg ", `<svg x="${at.x - anchor.x}" y="${at.y - anchor.y}" width="${size}" height="${size}" ${extra}`);

// A label as the viewer draws it: a chip with the kind's icon, tied to its pin.
export function callout(name: string, icon: string, color: string, from: Point, left: number, top: number) {
  const width = name.length * 8 + 51;
  return `<g class="map-callout" style="--callout-color:${color}">
<line class="map-callout-connector" x1="${from.x}" y1="${from.y}" x2="${left + width / 2}" y2="${top + 18}"/>
<rect x="${left}" y="${top}" width="${width}" height="36" rx="12"/>${placed(icon, { x: left + 20, y: top + 18 }, 16, 'class="map-callout-icon" ')}
<text x="${left + 38}" y="${top + 23}">${name}</text></g>`;
}

export function route(points: Point[], color = routeColors[0]!) {
  const d = `M${points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L")}`;
  const dots = points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${PIN_CASING}"/><circle cx="${p.x}" cy="${p.y}" r="2" fill="${color}"/>`).join("");
  return `<path d="${d}" fill="none" stroke="${PIN_CASING}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`
    + placed(icons.routeStart, points[0]!, 20, `fill="${color}" stroke="${PIN_CASING}" stroke-width="3.6" `)
    + placed(icons.routeEnd, points.at(-1)!, 20, `fill="${PIN_CASING}" stroke="${color}" stroke-width="3.6" `);
}

export function fakePlan() {
  const places: [MapMarker["kind"], string, Point, number, number][] = [
    ["graffiti", "Fresque du chat", { x: 110, y: 170 }, 20, 92],
    ["sculpture", "Le gardien", { x: 250, y: 205 }, 168, 146],
    ["shaft", "Puits Lalande", { x: 345, y: 250 }, 150, 236],
    ["room", "Salle Z", { x: 105, y: 650 }, 22, 590],
    ["entrance", "Entrée Est", { x: 330, y: 690 }, 250, 610],
  ];
  const path = [{ x: 330, y: 690 }, { x: 290, y: 700 }, { x: 230, y: 690 }, { x: 180, y: 640 }, { x: 140, y: 650 }, { x: 105, y: 650 }];
  return `<svg class="landing-map" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${planScan}${route(path)}
${places.map(([kind, name, point, left, top]) => callout(name, markerCalloutIcon(kind), markerKinds[kind].color, point, left, top)).join("")}
${places.map(([kind, , point]) => placed(placeIcon(kind), point, PLACE_PIN.size, "", PLACE_PIN.tip)).join("")}</svg>`;
}
