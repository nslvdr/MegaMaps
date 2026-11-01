import { t } from "../i18n";
import { preference, setPreference } from "../preferences";
import { track } from "../stats";
import { dialogHeader, showDialog } from "./dialog";
import { icons } from "./icons";
import { GESTURE, measureEnds, on, pinOnScreen, routePoints, scaleEnds, spot, TourMap, type Move } from "./tour-map";
import { showScene, tapTarget, tourScreenMarkup } from "./tour-screen";
import type { WheelChoice } from "./hold-wheel";

// Getting started and the tutorials act features out on a phone that runs the
// app's own screens and viewer over the example map. Each step starts from
// where the last one ended (or from its own `from`), a finger acts, and the
// phone then shows `show`: the space-separated parts and map states.
type Point = { x: number; y: number };
type Touch =
  | { move: "tap"; at: Point[] }
  | { move: "hold"; at: Point; to: Point; choice: WheelChoice }
  | { move: "drag"; at: Point; to: Point }
  | { move: "pinch" | "twist"; at: Point };
type Step = { text?: string; from?: string; show?: string; tap?: string; touch?: Touch };
type Guide = { id: string; title: string; text?: string; icon: string; color: string; steps: Step[]; note?: string };

// One timeline for every step, in ms from when its finger starts, slow
// enough to follow: each step first shows where it starts for LEAD, the hand
// glides in, presses, and the screen's answer then stays a while to read.
const LEAD = 1200;
const STEP_TIME = 4600;
const HOLD_TIME = 6800;
/** A finger touches what it taps, then the app answers. */
const PRESS = 1300;
const ANSWER = 1600;
/** The hand's size as it touches, against 1 just above the screen. */
const PRESSED = 0.8;
/** Taps along the map come this far apart. */
const TAP_GAP = 1100;
/** A hand shows above where it touches by here, and fades out this long after lifting. */
const ARRIVE = 600;
const LEAVE = 500;
/** The map follows a drag, pinch or twist from here, for GESTURE. */
const MOVE = 1000;
/** The wheel shows under a held finger, lights the third it's dragged into, then goes with the lift. */
const WHEEL = 1600;
const CHOICE = 2900;
const LIFT = 4200;
/** Back to the first step, the screen fades to black and back in. */
const FADE = 400;

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
      { touch: { move: "drag", at: on(329, 514), to: on(329, 454) }, show: "panned" },
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
      { from: "", touch: { move: "drag", at: on(329, 514), to: on(329, 454) }, show: "panned" },
      { touch: { move: "pinch", at: on(259, 369) }, show: "panned zoomed" },
      { touch: { move: "tap", at: [pinOnScreen("panned zoomed", spot.gardien)] }, show: "panned zoomed place" },
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
        { text: t("Turn the map with two fingers"), from: "manual", touch: { move: "twist", at: on(259, 429) }, show: "manual turned" },
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
        { text: t("Tap a place to read about it"), from: "panned", touch: { move: "tap", at: [pinOnScreen("panned", spot.gardien)] }, show: "panned place" },
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
        { text: t("Each mark joins your trail"), touch: { move: "drag", at: on(209, 334), to: on(289, 574) }, show: "trail away" },
        { text: t("Lost? Hold, then drag up-right"), touch: { move: "hold", at: on(239, 444), to: on(289, 394), choice: "back" }, show: "trail" },
        { text: t("The map comes back to your last mark"), show: "trail" },
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
        { text: t("Type a name in the search field"), from: "", tap: "search", show: "query count" },
        { text: t("Matches light up on the map; tap the count to go through them"), tap: "count", show: "query count next panned" },
        { text: t("Put ; between two names to find where they meet"), tap: "search", show: "query-pair count" },
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
<div class="tour-phone" id="tour-phone" aria-hidden="true">${tourScreenMarkup}</div>
<h2 id="tour-title"></h2><p id="tour-text"></p>
<ol class="share-summary tour-steps" id="tour-steps"></ol><p class="dialog-note" id="tour-note"></p>
<div id="tour-list" class="tour-list"><div class="share-summary"><button type="button" class="share-row" data-guide="basics"><span class="share-row-icon" style="--k:var(--neon-add)">${icons.sparkle}</span><span class="share-row-label">${t("Getting started")}<small>${t("The basics in three steps")}</small></span>${icons.arrow}</button></div>
${groups.map(([title, guides]) => `<h3 class="settings-heading">${title}</h3><div class="share-summary">${guides.map((guide) =>
  `<button type="button" class="share-row" data-guide="${guide.id}"><span class="share-row-icon" style="--k:${guide.color}">${guide.icon}</span><span class="share-row-label">${guide.title}</span>${icons.arrow}</button>`).join("")}</div>`).join("")}
<h3 class="settings-heading">${t("Still stuck?")}</h3><div class="share-summary"><a class="share-row tour-report" href="https://github.com/nslvdr/MegaMaps/issues/new" target="_blank" rel="noopener"><span class="share-row-icon" style="--k:var(--neon-view)">${icons.help}</span><span class="share-row-label">${t("Report a problem")}<small>${t("Opens GitHub, with a free account")}</small></span>${icons.externalLink}</a></div></div>
<button type="button" class="primary" id="tour-next"></button>
</dialog>
<dialog id="tour-offer" aria-labelledby="tour-offer-title">${dialogHeader("tour-offer-title", t("New: tutorials"), icons.sparkle, "tour-offer-close")}<p>${t("Short animated guides now show how each feature works, from adding places to finding crossings.")}</p><p class="dialog-note">${t("You can find them anytime at the bottom of the main screen.")}</p><div class="dialog-actions"><button type="button" id="tour-offer-yes" class="primary">${icons.sparkle}<span>${t("Show me")}</span></button><button type="button" id="tour-offer-no" class="quiet">${t("Not now")}</button></div></dialog>`;

// A finger acts out each touch on the step's timeline, using the Web
// Animations API where there is one. `start` is how far into the step it is.
function act(fingers: HTMLElement[], touch: Touch | undefined, start = 0) {
  for (const finger of fingers) finger.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel());
  if (!touch || !fingers[0]!.animate) return;
  // Each frame: when, where, the hand's size (PRESSED when it touches) and
  // how much it shows.
  type Frame = [number, Point, number?, number?];
  const down = (frame?: Frame) => !!frame && (frame[2] ?? PRESSED) <= PRESSED;
  const run = (finger: HTMLElement, frames: Frame[], end: number) => {
    const timing = { duration: end - start, fill: "both", easing: "ease-in-out" } as const;
    const offset = (ms: number) => (ms - start) / (end - start);
    // The hand glides in to its first touch, so the eye follows it there.
    const [[ms, { x, y }, ...rest], ...others] = frames as [Frame, ...Frame[]];
    frames = [[ms, on(x + 36, y + 48), ...rest], ...others];
    finger.animate(frames.map(([ms, { x, y }, , opacity = 1]) => ({ offset: offset(ms), opacity, transform: `translate(${x}px, ${y}px)` })), timing);
    finger.querySelector(".tour-hand")!.animate(frames.map(([ms, , scale = PRESSED]) => ({ offset: offset(ms), transform: `scale(${scale})` })), timing);
    finger.querySelector(".tour-touch")!.animate(frames.map((frame) => ({ offset: offset(frame[0]), opacity: down(frame) ? 1 : 0 })), timing);
    const ripple = finger.querySelector(".tour-ripple")!;
    frames.forEach((frame, i) => {
      if (down(frame) && !down(frames[i - 1]))
        ripple.animate([{ opacity: 1, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(2.4)" }], { duration: 700, delay: frame[0] - start, easing: "ease-out" });
    });
  };
  if (touch.move === "tap") {
    const last = touch.at.length - 1;
    const press = (i: number) => PRESS + i * TAP_GAP;
    run(fingers[0]!, [[start, touch.at[0]!, 1.3, 0], [press(0) - 450, touch.at[0]!, 1], ...touch.at.flatMap((point, i): [number, Point, number?][] =>
      [[press(i) - 250, point, 1], [press(i), point], [press(i) + 200, point], [press(i) + 450, point, 1]]),
    [press(last) + 450 + LEAVE, touch.at[last]!, 1, 0]], press(last) + 450 + LEAVE);
  } else if (touch.move === "hold") {
    run(fingers[0]!, [[0, touch.at, 1.3, 0], [ARRIVE, touch.at, 1], [MOVE, touch.at], [WHEEL + 300, touch.at], [CHOICE, touch.to], [LIFT - 200, touch.to], [LIFT, touch.to, 1], [LIFT + LEAVE, touch.to, 1, 0]], LIFT + LEAVE);
  } else if (touch.move === "drag") {
    run(fingers[0]!, [[0, touch.at, 1.3, 0], [ARRIVE, touch.at, 1], [MOVE, touch.at], [MOVE + GESTURE, touch.to], [MOVE + GESTURE + 200, touch.to, 1], [MOVE + GESTURE + 200 + LEAVE, touch.to, 1, 0]], MOVE + GESTURE + 200 + LEAVE);
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
      run(finger, [[0, from, 1.3, 0], [ARRIVE, from, 1], [MOVE, from], [MOVE + GESTURE, to], [MOVE + GESTURE + 200, to, 1], [MOVE + GESTURE + 200 + LEAVE, to, 1, 0]], MOVE + GESTURE + 200 + LEAVE);
    });
  }
}

const stepTime = ({ touch }: Step) =>
  touch?.move === "hold" ? HOLD_TIME : touch?.move === "tap" ? Math.max(STEP_TIME, PRESS + touch.at.length * TAP_GAP + 2500) : STEP_TIME;

type View = { kind: "basics"; page: number } | { kind: "list" } | { kind: "guide"; guide: Guide };

/** The full-page tour: Getting started, the tutorial list and each tutorial. */
export function initTutorials(tour: HTMLDialogElement, offer: HTMLDialogElement) {
  const part = <T extends HTMLElement = HTMLElement>(id: string) => tour.querySelector<T>(`#${id}`)!;
  const screenBox = part("tour-screen");
  const stepList = part("tour-steps");
  const next = part<HTMLButtonElement>("tour-next");
  const fingers = [...screenBox.querySelectorAll<HTMLElement>(".tour-finger")];
  const wheel = screenBox.querySelector<HTMLElement>('[data-id="hold-wheel"]')!;
  const map = new TourMap(screenBox);
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
    screenBox.classList.remove("fading");
  };
  // What the phone shows: the app's screens and its map set up as `show`
  // names them, getting there as `move` says.
  const display = (show: string, move: Move = "glide", drawn?: number) => {
    screenBox.dataset.show = show;
    showScene(screenBox, show, move === "jump", drawn);
    map.display(show, move, drawn);
  };

  const showStep = (index: number) => {
    stop();
    const current = steps[index]!;
    const { show = "", tap, touch } = current;
    display(current.from ?? steps[index - 1]?.show ?? "", "jump");
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
    } else if (touch?.move === "tap") {
      after(0, () => act(fingers, touch));
      // A line tapped out gains a point with each tap.
      touch.at.forEach((_, i) => after(ANSWER + i * TAP_GAP, () => display(show, "glide", i + 1)));
    } else if (touch) {
      after(0, () => act(fingers, touch));
      after(MOVE, () => display(show, "gesture"));
    } else after(ANSWER, () => display(show));
    // The last step fades out, so starting over doesn't read as one more step.
    after(stepTime(current), () => {
      if (index + 1 < steps.length) return showStep(index + 1);
      screenBox.classList.add("fading");
      later(FADE, () => showStep(0));
    });
  };

  const render = (to: View) => {
    view = to;
    stop();
    const guide = to.kind === "basics" ? basics[to.page]! : to.kind === "guide" ? to.guide : undefined;
    tour.dataset.view = to.kind;
    part("tour-back").hidden = to.kind !== "guide";
    part("tour-phone").hidden = !guide;
    part("tour-list").hidden = to.kind !== "list";
    part("tour-dots").innerHTML = to.kind === "basics" ? basics.map((_, i) => `<i${i === to.page ? ' class="on"' : ""}></i>`).join("") : "";
    part("tour-title").textContent = guide?.title ?? t("Tutorials");
    part("tour-text").textContent = guide ? guide.text ?? "" : t("Short animated guides for each feature.");
    part("tour-text").hidden = !part("tour-text").textContent;
    stepList.innerHTML = to.kind === "guide" ? to.guide.steps.map((s, i) => `<li class="share-row"><span class="share-row-icon" style="--k:${to.guide.color}">${i + 1}</span><span class="share-row-label">${s.text}</span></li>`).join("") : "";
    stepList.hidden = to.kind !== "guide";
    part("tour-note").textContent = to.kind === "guide" ? to.guide.note ?? "" : "";
    part("tour-note").hidden = !part("tour-note").textContent;
    // A tutorial plays on its own: nothing leads on to the next one.
    next.hidden = to.kind === "list" ? !finished : to.kind === "guide";
    next.innerHTML = to.kind === "basics"
      ? `<span>${to.page < basics.length - 1 ? t("Next") : t("See the tutorials")}</span>${icons.next}`
      : `${icons.check}<span>${t("Start using Mega Maps")}</span>`;
    steps = guide?.steps ?? [];
    if (guide) showStep(0);
    else map.stop();
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
  tour.addEventListener("close", () => {
    stop();
    map.stop();
  });

  const answer = (yes: boolean) => {
    track("tour_offer_answered", { yes });
    offer.close();
    if (yes) open({ kind: "basics", page: 0 });
  };
  offer.querySelector("#tour-offer-yes")!.addEventListener("click", () => answer(true));
  offer.querySelector("#tour-offer-no")!.addEventListener("click", () => answer(false));
  offer.querySelector("#tour-offer-close")!.addEventListener("click", () => answer(false));

  return {
    /** The main screen opens the list of tutorials. */
    openList: () => open({ kind: "list" }),
    /** A map panel opens the tutorial for what it does. */
    openGuide(id: string) {
      const guide = tutorials.find((guide) => guide.id === id);
      if (!guide) return;
      track("tutorial_opened", { tutorial: guide.id, from: "map" });
      open({ kind: "guide", guide });
    },
    /** The first launch shows Getting started; someone who already has maps is asked once instead.
     *  Returns whether it showed anything. */
    atLaunch(hasMaps: boolean) {
      if (preference("tour") === "seen") return false;
      setPreference("tour", "seen");
      if (hasMaps) showDialog(offer);
      else open({ kind: "basics", page: 0 });
      return true;
    },
  };
}
