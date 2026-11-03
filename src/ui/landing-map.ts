import { crossing, features, PLAN_DARK, planMarkup } from "../example/plan";
import { routeColors, type MapMarker } from "../viewer/navigation";
import { CalloutLayout, type CalloutBounds } from "../viewer/callout-layout";
import { MapBalloon, placeSymbol } from "../viewer/map-balloon";
import { icons } from "./icons";
import { PIN_CASING, PLACE_PIN } from "./place-icon";

// The landing page's backdrop: the example map as the app shows it, darkened,
// with places and a route drawn over it by the app itself. Each place shows
// as its open balloon, which takes the place of its pin.
type Point = { x: number; y: number };

// App icons are sized and centred like the viewer's route pins.
const placed = (markup: string, at: Point, size: number, extra = "") =>
  markup.replace("<svg ", `<svg x="${at.x - size / 2}" y="${at.y - size / 2}" width="${size}" height="${size}" ${extra}`);

// Names as the viewer draws them: balloons grown out of their pins, each on
// the first side free of the others, the pins and the route.
function balloons(places: [MapMarker["kind"], string, Point][], route: Point[]) {
  // As the viewer reserves them: a pin's head down to its tip, and a route's points.
  const pins = places.map(([, , { x, y }]): CalloutBounds =>
    ({ left: x - 12, right: x + 12, top: y - PLACE_PIN.head - 12, bottom: y + 2 }));
  const points = route.map(({ x, y }): CalloutBounds => ({ left: x - 8, right: x + 8, top: y - 8, bottom: y + 8 }));
  const layout = new CalloutLayout({ width: 340, height: 700 }, [...pins, ...points]);
  return places.map(([kind, name, point], i) => {
    const balloon = new MapBalloon(placeSymbol({ kind }));
    balloon.setText(name);
    balloon.still(point, layout, [pins[i]!]);
    return balloon.element.outerHTML;
  }).join("");
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
  const places: [MapMarker["kind"], string, Point][] = [
    ["entrance", "Entrée Ouest", crossing(-4, -9)],
    ["graffiti", "Fresque du chat", crossing(2, -6)],
    ["shaft", "Puits Lalande", features.airShaft],
    ["room", "Salle Z", features.salleZ],
    ["sculpture", "Le gardien", features.sculpture],
  ];
  const path = [crossing(-4, -9), crossing(-1, -9), crossing(-1, 1), crossing(2, 1)];
  return `<div class="landing-map" style="--plan-dark:${PLAN_DARK}" aria-hidden="true">${planMarkup(340, view).replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" ')}
<svg viewBox="${view}" preserveAspectRatio="xMidYMid slice">${route(path)}${balloons(places, path)}</svg></div>`;
}
