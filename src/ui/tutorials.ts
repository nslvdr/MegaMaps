import { crossing, features, galleryNames, PLAN_DARK, PLAN_HEIGHT, PLAN_WIDTH, planMarkup, scaleBar, textWidth, type PlanText } from "../example/plan";
import { t } from "../i18n";
import { preference, setPreference } from "../preferences";
import { track } from "../stats";
import { markerKinds, routeColors, type MapMarker } from "../viewer/navigation";
import { dialogHeader, showDialog } from "./dialog";
import { icons, markerCalloutIcon } from "./icons";
import { callout, placed, route } from "./landing-map";
import { PLACE_PIN, placeIcon } from "./place-icon";
import { showScene, tapTarget, tourScreenMarkup } from "./tour-screen";
import type { WheelChoice } from "./hold-wheel";

// Getting started and the tutorials act features out on a phone that runs the
// app's own screens over the example map. Each step starts from where the
// last one ended (or from its own `from`), a finger acts, and the phone then
// shows `show`: the space-separated parts, map layers and map states.
type Point = { x: number; y: number };
type Touch =
  | { move: "tap"; at: Point[] }
  | { move: "hold"; at: Point; to: Point; choice: WheelChoice }
  | { move: "drag"; at: Point; to: Point }
  | { move: "pinch" | "twist"; at: Point };
type Step = { text?: string; from?: string; show?: string; tap?: string; touch?: Touch };
type Guide = { id: string; title: string; text?: string; icon: string; color: string; steps: Step[]; note?: string };

// One timeline for every step, in ms from when its finger starts. Each step
// first shows where it starts for LEAD, so the gesture is never missed.
const LEAD = 900;
const STEP_TIME = 3200;
const HOLD_TIME = 4200;
/** A finger touches what it taps, then the app answers. */
const PRESS = 550;
const ANSWER = 650;
/** Taps along the map come this far apart. */
const TAP_GAP = 500;
/** The map follows a drag, pinch or twist from here, for MOVE_TIME. */
const MOVE = 400;
const MOVE_TIME = 900;
/** The wheel shows under a held finger, lights the third it's dragged into, then goes with the lift. */
const WHEEL = 700;
const CHOICE = 1300;
const LIFT = 2300;

/** The phone's screen is a 375×667 viewer over the example plan, which sits this far up and left. */
const PLAN_OFFSET = { x: 380, y: 330 };
const on = (x: number, y: number): Point => ({ x, y });
/** Where a point of the plan shows on the screen, with the map at rest. */
const seen = ({ x, y }: Point) => on(Math.round(x - PLAN_OFFSET.x), Math.round(y - PLAN_OFFSET.y));
/** A crossing of the plan's galleries: routes and trails keep to them. */
const at = (i: number, j: number) => seen(crossing(i, j));

// Map spots, in screen pixels with the map at rest.
const spot = {
  chatiere: seen(features.chatiere),
  gardien: seen(features.sculpture),
  puits: seen(features.airShaft),
  shared: seen(features.salleZ),
  mark: at(1, -3),
};
const trailPoints = [at(-1, -8), at(-1, -5), at(1, -5)];
const routePoints = [at(-4, -9), at(-1, -9), at(-1, -4), at(2, -4)];
const scaleEnds = scaleBar.map(seen);
const measureEnds = [at(-1, -8), at(-1, -2.5)];

const toPlan = (point: Point) => ({ x: point.x + PLAN_OFFSET.x, y: point.y + PLAN_OFFSET.y });
const pin = (kind: MapMarker["kind"], at: Point) => placed(placeIcon(kind), toPlan(at), PLACE_PIN.size, "", PLACE_PIN.tip);
const place = (kind: MapMarker["kind"], name: string, at: Point, left: number, top: number) =>
  callout(name, markerCalloutIcon(kind), markerKinds[kind].color, toPlan(at), left + PLAN_OFFSET.x, top + PLAN_OFFSET.y) + pin(kind, at);
const line = (points: Point[]) => `M${points.map((p) => { const { x, y } = toPlan(p); return `${x} ${y}`; }).join("L")}`;
const dots = (points: Point[], extra = (_: number) => "") =>
  points.map((p, i) => { const { x, y } = toPlan(p); return `<circle cx="${x}" cy="${y}" r="4"${extra(i)}/>`; }).join("");
// The boxes text search draws round the gallery names it finds: both Allée 25
// for one name, and the Allée 25 and 55 that meet for a pair.
const [north, south, allee55] = galleryNames;
const found = (layer: string) => ({ at, angle, ...text }: PlanText) =>
  `<rect class="tour-found" data-layer="${layer}" transform="translate(${at.x} ${at.y}) rotate(${angle})" x="${-(textWidth(text) + 10) / 2}" y="-9" width="${textWidth(text) + 10}" height="18" rx="5"/>`;
const meet = crossing(0, 0);
// A line tapped point by point: each dot lands with the finger, and the
// stretch to it follows. Delays count from when the step's answer shows.
const drawing = (points: Point[], color: string) =>
  points.slice(1).map((point, i) =>
    `<path d="${line([points[i]!, point])}" pathLength="1" class="tour-draw" style="--c:${color};animation-delay:${PRESS - ANSWER + (i + 1) * TAP_GAP}ms"/>`).join("")
  + dots(points, (i) => ` class="tour-dot" style="--c:${color};animation-delay:${PRESS - ANSWER + i * TAP_GAP}ms"`);

// Two layers: the scan, darkened as the app does unless Dark map is off, and
// what the app draws over it.
const plan = `<div class="tour-plan" style="left:${-PLAN_OFFSET.x}px;top:${-PLAN_OFFSET.y}px;width:${PLAN_WIDTH}px;height:${PLAN_HEIGHT}px;transform-origin:${PLAN_OFFSET.x + 227}px ${PLAN_OFFSET.y + 285}px;--plan-dark:${PLAN_DARK}">
${planMarkup().replace("<svg ", '<svg class="tour-scan" ')}
<svg class="tour-marks" viewBox="0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}">${[north!, south!].map(found("found")).join("")}${[south!, allee55!].map(found("pair")).join("")}
<circle class="tour-meet" data-layer="pair" cx="${meet.x}" cy="${meet.y}" r="16"/>
<g class="tour-trail" data-layer="trail-old"><path d="${line(trailPoints)}"/>${dots(trailPoints)}</g>
<g class="tour-trail" data-layer="trail"><path d="${line([...trailPoints, spot.mark])}"/>${dots(trailPoints)}<circle class="tour-mark" cx="${toPlan(spot.mark).x}" cy="${toPlan(spot.mark).y}" r="7"/></g>
<circle class="tour-glow" data-layer="glow" cx="${toPlan(spot.mark).x}" cy="${toPlan(spot.mark).y}" r="7"/>
<g data-layer="route-drawing">${drawing(routePoints, routeColors[0]!)}</g>
<g data-layer="route">${route(routePoints.map(toPlan))}</g>
<g data-layer="shared">${route([spot.shared, at(-3, 1), spot.puits].map(toPlan), routeColors[1])}${place("room", "Salle Z", spot.shared, 250, 420)}</g>
<g data-layer="scale">${drawing(scaleEnds, "var(--neon-measure)")}</g>
<g data-layer="measure">${drawing(measureEnds, "var(--neon-measure)")}</g>
${place("shaft", "Puits Lalande", spot.puits, 14, 240)}${place("sculpture", "Le gardien", spot.gardien, 40, 470)}
<g data-layer="chatiere">${place("passage", "Chatière", spot.chatiere, 250, 232)}</g>
</svg></div>`;

const screen = tourScreenMarkup(plan);

const wheelLabels: Record<WheelChoice, string> = {
  place: t("Add a place"),
  back: t("Go to last mark"),
  trail: t("Mark where you are"),
};

// Getting started: only the basics, then the list of tutorials.
const basics: Guide[] = [
  {
    id: "welcome", title: t("Your maps, even underground"), icon: icons.map, color: "var(--neon-saved)",
    text: t("Mega Maps keeps big scans of quarry and cave plans on your phone. Once a map is in, it works with no signal."),
    steps: [
      { from: "library map-card", tap: "open-map" },
      { touch: { move: "drag", at: on(297, 370), to: on(297, 310) }, show: "panned" },
    ],
  },
  {
    id: "import", title: t("Import a map"), icon: icons.download, color: "var(--neon-add)",
    text: t("Tap Import and pick a photo or scan of the plan. Mega Maps prepares it once, then it opens in a blink."),
    steps: [
      { from: "library", tap: "import", show: "library import" },
      { tap: "new-map", show: "library progress" },
      { show: "library map-card" },
    ],
  },
  {
    id: "explore", title: t("Find your way around"), icon: icons.pin, color: "var(--neon-view)",
    text: t("Drag to move, pinch to zoom. Tap a place to read what’s there."),
    steps: [
      { from: "", touch: { move: "drag", at: on(297, 370), to: on(297, 310) }, show: "panned" },
      { touch: { move: "pinch", at: on(227, 225) }, show: "panned zoomed" },
      { touch: { move: "tap", at: [on(166, 325)] }, show: "panned zoomed place" },
    ],
  },
];

const groups: [string, Guide[]][] = [
  [t("Map"), [
    {
      id: "rotate", title: t("Rotate the map"), icon: icons.freeRotation, color: "var(--neon-lock)",
      steps: [
        { text: t("Tap Rotation at the top"), from: "", tap: "rotation", show: "rotation" },
        { text: t("Choose Manual"), tap: "manual", show: "rotation manual" },
        { text: t("Turn the map with two fingers"), from: "manual", touch: { move: "twist", at: on(227, 285) }, show: "manual turned" },
      ],
      note: t("Locked keeps north up. Compass modes turn the map as you turn."),
    },
    {
      id: "view", title: t("Dark map and brightness"), icon: icons.sun, color: "var(--neon-view)",
      steps: [
        { text: t("Tap View at the top"), from: "", tap: "view", show: "view" },
        { text: t("Dark map is on: turn it off to see the plan as scanned"), tap: "dark", show: "view paper" },
        { text: t("Turn it back on: the plan goes white on black"), tap: "dark", show: "view" },
        { text: t("Lower the brightness so places and routes stand out"), tap: "dim", show: "view dim" },
      ],
    },
  ]],
  [t("Places"), [
    {
      id: "add-place", title: t("Add a place"), icon: icons.added, color: "var(--neon-add)",
      steps: [
        { text: t("Press and hold where it goes, drag up-left to Add a place, then lift"), from: "", touch: { move: "hold", at: spot.chatiere, to: on(spot.chatiere.x - 50, spot.chatiere.y - 50), choice: "place" }, show: "new-place" },
        { text: t("Name it and pick its type, then tap Save"), tap: "save", show: "chatiere chatiere-saved" },
        { text: t("It’s on the map, and in Saved"), tap: "saved", show: "chatiere saved" },
      ],
      note: t("You can also tap Add, then Place."),
    },
    {
      id: "read-place", title: t("Read and edit a place"), icon: icons.edit, color: "var(--neon-add)",
      steps: [
        { text: t("Tap a place to read about it"), from: "panned", touch: { move: "tap", at: [on(spot.gardien.x, spot.gardien.y - 78)] }, show: "panned place" },
        { text: t("Tap Edit to change its name, type, notes or photos"), tap: "edit", show: "panned edit" },
        { text: t("Move puts its pin somewhere else"), tap: "move", show: "panned move-tool" },
        { text: t("Drag the pin, or tap where it goes, then tap Done"), tap: "done", show: "panned" },
      ],
    },
  ]],
  [t("On the way"), [
    {
      id: "trail", title: t("Mark your path"), icon: icons.trail, color: "var(--neon-trail)",
      steps: [
        { text: t("Hold the map where you are, drag down, then lift"), from: "trail-old", touch: { move: "hold", at: spot.mark, to: on(spot.mark.x, spot.mark.y + 60), choice: "trail" }, show: "trail trail-added" },
        { text: t("Each mark joins your trail"), touch: { move: "drag", at: on(177, 190), to: on(257, 430) }, show: "trail away" },
        { text: t("Lost? Hold, then drag up-right"), touch: { move: "hold", at: on(207, 300), to: on(257, 250), choice: "back" }, show: "trail" },
        { text: t("The map comes back to your last mark"), show: "trail glow" },
      ],
      note: t("Tap Trail at the top to see your trip, or end it."),
    },
    {
      id: "route", title: t("Draw a route"), icon: icons.route, color: "var(--kind-route)",
      steps: [
        { text: t("Tap Add"), from: "", tap: "add", show: "add" },
        { text: t("Choose Route"), tap: "route", show: "route-tool" },
        { text: t("Tap where it starts, then each point along the way"), touch: { move: "tap", at: routePoints }, show: "route-tool route-drawing" },
        { text: t("Tap Done to save it"), tap: "done", show: "route route-saved" },
      ],
      note: t("Once the map has a scale, routes show their length and walking time."),
    },
    {
      id: "measure", title: t("Measure a distance"), icon: icons.measure, color: "var(--neon-measure)",
      steps: [
        { text: t("Tap Measure at the top"), from: "", tap: "measure", show: "scale-ask" },
        { text: t("The first time, it asks for the scale: tap Set scale"), tap: "scale-start", show: "scale-tool" },
        { text: t("Tap both ends of the scale bar"), touch: { move: "tap", at: scaleEnds }, show: "scale-tool scale" },
        { text: t("Enter its length"), from: "scale-tool scale scale-length", tap: "scale-save", show: "measure-tool scale-set" },
        { text: t("Then tap along what you want to measure"), touch: { move: "tap", at: measureEnds }, show: "measure-tool measure" },
      ],
      note: t("Each map asks for its scale once."),
    },
  ]],
  [t("Text"), [
    {
      id: "detect", title: t("Detect the map’s text"), icon: icons.scanText, color: "var(--neon-saved)",
      steps: [
        { text: t("After an import, choose Detect text"), from: "library map-card ocr", tap: "detect", show: "ocr-toast" },
        { text: t("It reads the labels on the phone; keep the app open"), show: "ocr-toast" },
        { text: t("To run it again, tap ⋯ on the map"), from: "library map-card", tap: "more", show: "library map-card actions" },
        { text: t("Then choose Advanced settings"), tap: "advanced", show: "library map-card advanced" },
      ],
    },
    {
      id: "search", title: t("Search and find crossings"), icon: icons.search, color: "var(--neon-saved)",
      steps: [
        { text: t("Type a name in the search field"), from: "", tap: "search", show: "query count found" },
        { text: t("Matches light up on the map; tap the count to go through them"), tap: "count", show: "query count found panned" },
        { text: t("Put ; between two names to find where they meet"), tap: "search", show: "query-pair count-pair pair" },
      ],
      note: t("Search also finds your saved places by name or description."),
    },
  ]],
  [t("Sharing"), [
    {
      id: "share", title: t("Share with a teammate"), icon: icons.share, color: "var(--neon-saved)",
      steps: [
        { text: t("Tap Saved"), from: "", tap: "saved", show: "saved" },
        { text: t("Tap Share"), tap: "share", show: "share" },
        { text: t("Choose what to send, then tap Share file"), tap: "send", show: "" },
      ],
      note: t("Send the .megamap file any way you like: messages, mail or AirDrop."),
    },
    {
      id: "open-share", title: t("Open a shared file"), icon: icons.download, color: "var(--neon-saved)",
      steps: [
        { text: t("Tap Import"), from: "library map-card", tap: "import", show: "library map-card import" },
        { text: t("Choose Shared file, then pick the .megamap"), tap: "shared-file", show: "library map-card receive" },
        { text: t("Merge adds their places and routes to your map"), tap: "receive", show: "shared" },
        { text: t("They show up on the map"), show: "shared" },
      ],
    },
    {
      id: "backup", title: t("Back up your maps"), icon: icons.backup, color: "var(--neon-saved)",
      steps: [
        { text: t("Open Settings"), from: "library map-card", tap: "settings", show: "settings" },
        { text: t("Tap Save a backup"), tap: "backup", show: "settings backed-up" },
        { text: t("Keep the file in Files or on another device"), show: "settings backed-up" },
        { text: t("On a new phone, Restore a backup brings it all back"), from: "settings", tap: "restore", show: "library map-card" },
      ],
    },
  ]],
];
export const tutorials = groups.flatMap(([, guides]) => guides);

export const tutorialsMarkup = `<dialog id="tour" class="tour" aria-labelledby="tour-title">
<div class="tour-bar"><button type="button" class="page-back" id="tour-back" aria-label="${t("All tutorials")}" title="${t("All tutorials")}" hidden>${icons.arrow}</button><span class="tour-dots" id="tour-dots"></span><button type="button" class="dialog-close" id="tour-close" aria-label="${t("Close")}" title="${t("Close")}">${icons.close}</button></div>
<div class="tour-phone" id="tour-phone" aria-hidden="true">${screen}</div>
<h2 id="tour-title"></h2><p id="tour-text"></p>
<ol class="share-summary tour-steps" id="tour-steps"></ol><p class="dialog-note" id="tour-note"></p>
<div id="tour-list" class="tour-list"><div class="share-summary"><button type="button" class="share-row" data-guide="basics"><span class="share-row-icon" style="--k:var(--neon-add)">${icons.sparkle}</span><span class="share-row-label">${t("Getting started")}<small>${t("The basics in three steps")}</small></span>${icons.arrow}</button></div>
${groups.map(([title, guides]) => `<h3 class="settings-heading">${title}</h3><div class="share-summary">${guides.map((guide) =>
  `<button type="button" class="share-row" data-guide="${guide.id}"><span class="share-row-icon" style="--k:${guide.color}">${guide.icon}</span><span class="share-row-label">${guide.title}</span>${icons.arrow}</button>`).join("")}</div>`).join("")}</div>
<button type="button" class="primary" id="tour-next"></button>
</dialog>
<dialog id="tour-offer" aria-labelledby="tour-offer-title">${dialogHeader("tour-offer-title", t("New: tutorials"), icons.sparkle, "tour-offer-close")}<p>${t("Short animated guides now show how each feature works, from adding places to finding crossings.")}</p><p class="dialog-note">${t("You can find them anytime in Settings.")}</p><div class="dialog-actions"><button type="button" id="tour-offer-yes" class="primary">${icons.sparkle}<span>${t("Show me")}</span></button><button type="button" id="tour-offer-no" class="quiet">${t("Not now")}</button></div></dialog>`;

// A finger acts out each touch on the step's timeline, using the Web
// Animations API where there is one. `start` is how far into the step it is.
function act(fingers: HTMLElement[], touch: Touch | undefined, start = 0) {
  for (const finger of fingers) finger.getAnimations?.().forEach((animation) => animation.cancel());
  if (!touch || !fingers[0]!.animate) return;
  const run = (finger: HTMLElement, frames: [number, Point, number?, number?][], end: number) =>
    finger.animate(frames.map(([ms, { x, y }, scale = 0.8, opacity = 1]) =>
      ({ offset: (ms - start) / (end - start), opacity, transform: `translate(${x}px, ${y}px) scale(${scale})` })),
    { duration: end - start, fill: "both", easing: "ease-in-out" });
  if (touch.move === "tap") {
    const last = touch.at.length - 1;
    const press = (i: number) => PRESS + i * TAP_GAP;
    run(fingers[0]!, [[start, touch.at[0]!, 1.3, 0], [press(0) - 200, touch.at[0]!, 1], ...touch.at.flatMap((point, i): [number, Point, number?][] =>
      [[press(i) - 120, point, 1], [press(i), point], [press(i) + 120, point, 1]]),
    [press(last) + 400, touch.at[last]!, 1, 0]], press(last) + 400);
  } else if (touch.move === "hold") {
    run(fingers[0]!, [[0, touch.at, 1.3, 0], [300, touch.at, 1], [MOVE, touch.at], [WHEEL + 200, touch.at], [CHOICE, touch.to], [LIFT, touch.to], [LIFT + 200, touch.to, 1, 0]], LIFT + 200);
  } else if (touch.move === "drag") {
    run(fingers[0]!, [[0, touch.at, 1.3, 0], [300, touch.at, 1], [MOVE, touch.at], [MOVE + MOVE_TIME, touch.to], [MOVE + MOVE_TIME + 200, touch.to, 1, 0]], MOVE + MOVE_TIME + 200);
  } else {
    // Two fingers: together for a pinch, round a circle for a twist, the
    // same way the map moves.
    const { x, y } = touch.at;
    const around = (angle: number, radius: number, side: number) => {
      const turn = (angle + side * 180) * Math.PI / 180;
      return on(x + Math.cos(turn) * radius, y + Math.sin(turn) * radius);
    };
    fingers.forEach((finger, side) => {
      const [from, to] = touch.move === "pinch" ? [around(-135, 80, side), around(-135, 60, side)] : [around(-10, 60, side), around(-34, 60, side)];
      run(finger, [[0, from, 1.3, 0], [300, from, 1], [MOVE, from], [MOVE + MOVE_TIME, to], [MOVE + MOVE_TIME + 200, to, 1, 0]], MOVE + MOVE_TIME + 200);
    });
  }
}

const stepTime = ({ touch }: Step) =>
  touch?.move === "hold" ? HOLD_TIME : touch?.move === "tap" ? Math.max(STEP_TIME, PRESS + touch.at.length * TAP_GAP + 1500) : STEP_TIME;

type View = { kind: "basics"; page: number } | { kind: "list" } | { kind: "guide"; guide: Guide };

/** The full-page tour: Getting started, the tutorial list and each tutorial. */
export function initTutorials(tour: HTMLDialogElement, offer: HTMLDialogElement) {
  const part = <T extends HTMLElement = HTMLElement>(id: string) => tour.querySelector<T>(`#${id}`)!;
  const screenBox = part("tour-screen");
  const stepList = part("tour-steps");
  const next = part<HTMLButtonElement>("tour-next");
  const fingers = [...screenBox.querySelectorAll<HTMLElement>(".tour-finger")];
  const wheel = screenBox.querySelector<HTMLElement>('[data-id="hold-wheel"]')!;
  let view: View = { kind: "list" };
  let steps: Step[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  // Getting started reached its list: its last button then starts the app.
  let finished = false;

  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    act(fingers, undefined);
  };
  // What the phone shows: the app's screens set up as `show` names them, map
  // layers on, and the map's own states matched in CSS.
  const display = (show: string, jump = false) => {
    const shown = show.split(" ");
    screenBox.dataset.show = show;
    for (const layer of screenBox.querySelectorAll("[data-layer]")) layer.classList.toggle("on", shown.includes(layer.getAttribute("data-layer")!));
    showScene(screenBox, show, jump);
  };

  const showStep = (index: number) => {
    stop();
    const current = steps[index]!;
    const { show = "", tap, touch } = current;
    display(current.from ?? steps[index - 1]?.show ?? "", true);
    screenBox.querySelectorAll(".tapped").forEach((target) => target.classList.remove("tapped"));
    wheel.hidden = true;
    stepList.querySelectorAll("li").forEach((item, i) => item.toggleAttribute("aria-current", i === index));
    // The step's starting point holds still for a moment before anything moves.
    const after = (ms: number, run: () => void) => later(LEAD + ms, run);
    if (tap) {
      const target = tapTarget(screenBox, tap);
      // Measured once what it touches has slid in.
      if (target) after(250, () => {
        // In the phone's own pixels, however small the page draws it.
        const box = screenBox.getBoundingClientRect(), rect = target.getBoundingClientRect();
        const scale = box.width / screenBox.offsetWidth || 1;
        act(fingers, { move: "tap", at: [on((rect.left - box.left + rect.width / 2) / scale, (rect.top - box.top + rect.height / 2) / scale)] }, 250);
      });
      if (target) after(PRESS, () => target.classList.add("tapped"));
      after(ANSWER, () => display(show));
    } else if (touch?.move === "hold") {
      after(0, () => act(fingers, touch));
      wheel.style.left = `${touch.at.x}px`;
      wheel.style.top = `${touch.at.y}px`;
      wheel.dataset.back = touch.choice === "place" ? "off" : "on";
      const label = wheel.querySelector('[data-id="hold-label"]')!;
      after(WHEEL, () => {
        delete wheel.dataset.choice;
        label.textContent = "";
        wheel.hidden = false;
      });
      after(CHOICE, () => {
        wheel.dataset.choice = touch.choice;
        label.textContent = wheelLabels[touch.choice];
      });
      after(LIFT, () => {
        wheel.hidden = true;
        display(show);
      });
    } else if (touch) {
      after(0, () => act(fingers, touch));
      after(touch.move === "tap" ? ANSWER : MOVE, () => display(show));
    } else after(ANSWER, () => display(show));
    after(stepTime(current), () => showStep((index + 1) % steps.length));
  };

  const render = (to: View) => {
    view = to;
    stop();
    const guide = to.kind === "basics" ? basics[to.page]! : to.kind === "guide" ? to.guide : undefined;
    const following = to.kind === "guide" ? tutorials[tutorials.indexOf(to.guide) + 1] : undefined;
    tour.dataset.view = to.kind;
    part("tour-back").hidden = to.kind !== "guide";
    part("tour-phone").hidden = !guide;
    part("tour-list").hidden = to.kind !== "list";
    part("tour-dots").innerHTML = to.kind === "basics" ? basics.map((_, i) => `<i${i === to.page ? ' class="on"' : ""}></i>`).join("") : "";
    part("tour-title").textContent = guide?.title ?? t("Tutorials");
    part("tour-text").textContent = guide ? guide.text ?? "" : t("Short guides for everything else. Find them anytime in Settings.");
    part("tour-text").hidden = !part("tour-text").textContent;
    stepList.innerHTML = to.kind === "guide" ? to.guide.steps.map((s, i) => `<li class="share-row"><span class="share-row-icon" style="--k:${to.guide.color}">${i + 1}</span><span class="share-row-label">${s.text}</span></li>`).join("") : "";
    stepList.hidden = to.kind !== "guide";
    part("tour-note").textContent = to.kind === "guide" ? to.guide.note ?? "" : "";
    part("tour-note").hidden = !part("tour-note").textContent;
    next.hidden = to.kind === "list" ? !finished : to.kind === "guide" && !following;
    next.innerHTML = to.kind === "basics"
      ? `<span>${to.page < basics.length - 1 ? t("Next") : t("See the tutorials")}</span>${icons.next}`
      : to.kind === "list" ? `${icons.check}<span>${t("Start using Mega Maps")}</span>` : `<span>${t("Next: {title}", { title: following?.title ?? "" })}</span>${icons.next}`;
    steps = guide?.steps ?? [];
    if (guide) showStep(0);
    tour.scrollTop = 0;
  };

  const open = (to: View) => {
    finished = false;
    render(to);
    if (!tour.open) showDialog(tour);
  };

  next.addEventListener("click", () => {
    if (view.kind === "basics" && view.page < basics.length - 1) return render({ kind: "basics", page: view.page + 1 });
    if (view.kind === "basics") {
      finished = true;
      track("tour_finished");
      return render({ kind: "list" });
    }
    if (view.kind === "guide") {
      const guide = tutorials[tutorials.indexOf(view.guide) + 1]!;
      track("tutorial_opened", { tutorial: guide.id, from: "next" });
      return render({ kind: "guide", guide });
    }
    tour.close();
  });
  part("tour-list").addEventListener("click", (event) => {
    const id = (event.target as Element).closest<HTMLElement>("[data-guide]")?.dataset.guide;
    if (id === "basics") return render({ kind: "basics", page: 0 });
    const guide = tutorials.find((guide) => guide.id === id);
    if (!guide) return;
    track("tutorial_opened", { tutorial: guide.id, from: "list" });
    render({ kind: "guide", guide });
  });
  // Tapping a step plays it, then the demo carries on from there.
  stepList.addEventListener("click", (event) => {
    const item = (event.target as Element).closest("li");
    if (item) showStep([...stepList.children].indexOf(item));
  });
  part("tour-back").addEventListener("click", () => render({ kind: "list" }));
  part("tour-close").addEventListener("click", () => {
    if (view.kind === "basics") track("tour_skipped", { page: view.page });
    tour.close();
  });
  tour.addEventListener("close", stop);

  const answer = (yes: boolean) => {
    track("tour_offer_answered", { yes });
    offer.close();
    if (yes) open({ kind: "basics", page: 0 });
  };
  offer.querySelector("#tour-offer-yes")!.addEventListener("click", () => answer(true));
  offer.querySelector("#tour-offer-no")!.addEventListener("click", () => answer(false));
  offer.querySelector("#tour-offer-close")!.addEventListener("click", () => answer(false));

  return {
    /** Settings opens the list of tutorials. */
    openList: () => open({ kind: "list" }),
    /** The first launch shows Getting started; someone who already has maps is asked once instead. */
    atLaunch(hasMaps: boolean) {
      if (preference("tour") === "seen") return;
      setPreference("tour", "seen");
      if (hasMaps) showDialog(offer);
      else open({ kind: "basics", page: 0 });
    },
  };
}
