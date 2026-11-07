import "fake-indexeddb/auto";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { $, cancel, click, document, fire, flushSync, pick, render, settle, submit, type, window } from "./dom";
import MapViewer from "../src/ui/map/MapViewer.svelte";
import { ViewerControls } from "../src/ui/viewer-controls.svelte";
import { defaultNavigation, type NavigationState, type PlannedRoute } from "../src/viewer/navigation";
import { saveMap } from "../src/storage/database";
import { loadNavigation } from "../src/storage/navigation";
import { savePhoto } from "../src/storage/photos";
import { worldToScreen, type Point } from "../src/viewer/camera";
import type { MapRecord } from "../src/types";
import type { MapSearchMatch } from "../src/viewer/map-search";
import { toLonLat, type Geo } from "../src/viewer/geo";

type Viewer = Parameters<ViewerControls["attach"]>[0];

/** The controls as the map calls on them: each call then lets the page update. */
function flushed<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result: unknown = value.apply(object, args);
        flushSync();
        return result && typeof result === "object" && Object.getPrototypeOf(result) === Object.prototype ? flushed(result) : result;
      };
    },
    set: (object, key, value) => Reflect.set(object, key, value),
  });
}

/** Opens a map: its controls, the page they drive, and a map that records what it's asked. */
function openMap(t: TestContext, map: MapRecord, state: NavigationState, viewer: Partial<Viewer> = {},
  share?: ConstructorParameters<typeof ViewerControls>[3]) {
  const raw = new ViewerControls(document.body, map, state, share);
  const page = render(MapViewer, { controls: raw, back() {}, hidden: false });
  const controls = flushed(raw);
  controls.attach({ setTool() {}, updateNavigation() {}, fitPoints() {}, jumpTo() {}, ...viewer });
  t.after(async () => {
    raw.dispose();
    await raw.flush();
    page.destroy();
  });
  return controls;
}

const mapRecord = (id: string, size = 1000): MapRecord => ({
  id, name: "quarry.png", width: size, height: size, bytes: 1, backend: "indexeddb", created: 0, status: "ready", levels: [],
});
/** Not on the page, or on it but hidden. */
const gone = (id: string) => {
  const element = document.getElementById(id);
  return !element || element.hidden;
};
const isOpen = (id: string) => $(id).hasAttribute("open");
const text = (id: string) => $(id).textContent!.trim();
const value = (id: string) => $<HTMLInputElement>(id).value;
const onWindow = (name: string, init?: Record<string, unknown>) => fire(window as unknown as EventTarget, name, init);
/** Facing a compass heading, sent as the event the app listens for. */
const heading = (degrees: number) =>
  onWindow("ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation", { webkitCompassHeading: degrees });
/** A Delete or X waiting for its second tap fills red. */
const armed = (element: Element) => element.classList.contains("bg-danger");
/** The ⋯ sheet of a Saved row, and its actions. */
const rowSheet = () => document.querySelector<HTMLDialogElement>("dialog[data-sheet][open]");
const sheetActions = () => [...rowSheet()!.querySelectorAll<HTMLButtonElement>("button:not([aria-label])")];
/** Waits for photos and other reads under way. */
async function until(done: () => boolean) {
  for (let turn = 0; turn < 400 && !done(); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    flushSync();
  }
}

test("viewer controls: menu pill, panels, smart dark, layers, highlight, rotation, places and routes", async (t) => {
  const focus = t.mock.method(window.HTMLElement.prototype, "focus");
  const map = mapRecord("controls", 9000);
  await saveMap(map);
  const state = defaultNavigation("controls");
  assert.equal(state.dimming, 0.85, "new maps default to 85% brightness");
  state.dimming = 0.8; // Simulate a brightness saved by the old slider.
  let labelRefreshes = 0;
  const tools: string[] = [],
    framed: Point[][] = [],
    jumps: Point[] = [];
  let highlights: { matches: MapSearchMatch[]; active: boolean; selected: number } | undefined;
  // A touch lock saved by an older version must not trap the map.
  state.touchLocked = true;
  const shares: ({ kind: "marker" | "route"; id: string } | undefined)[] = [];
  const previews: ({ point: Point; kind: string } | undefined)[] = [];
  const orientations: (number | undefined)[] = [];
  let straightened = 0;
  const pulses: string[] = [];
  const reveals: Point[] = [];
  const requestedZooms: (number | undefined)[] = [];
  let onScreen = true;
  const controls = openMap(t, map, state, {
    setTool(tool) { tools.push(tool); },
    jumpTo(point, minimumScale) {
      jumps.push(point);
      requestedZooms.push(minimumScale);
    },
    fitPoints(points) { framed.push(points); },
    setSearch(matches, active, selected = 0) { highlights = { matches, active, selected }; },
    refreshLabels() { labelRefreshes++; },
    orient(rotation) { orientations.push(rotation); },
    straighten() { straightened++; },
    previewPlace(place) { previews.push(place && { point: place.point, kind: place.kind }); },
    pulse(id) { pulses.push(id); },
    reveal(point) {
      reveals.push(point);
      return { x: 40, y: 300 };
    },
    showing: () => onScreen,
  }, (item) => shares.push(item));
  assert.equal(state.touchLocked, false);
  assert.equal(state.dimming, 0.85, "older brightness values use the nearest preset");
  const tick = (ms: number) => {
    t.mock.timers.tick(ms);
    flushSync();
  };
  const enter = () => fire("map-search", "keydown", { key: "Enter" });
  const tap = (x: number, y: number) => controls.options().onTap({ x, y });
  const sheet = $("sheet"),
    dock = $("dock"),
    toolBar = $("tool-bar");
  const tool = () => $("viewer").dataset.tool;

  // Browsing: just the menu pill, no panel, no zoom/pan/position buttons.
  assert.equal(sheet.hidden, true);
  assert.equal(dock.hidden, false);
  for (const id of ["zoom-in", "zoom-out", "touch-lock", "viewer-title", "compass", "locate", "map-rail", "set-position",
    "layer-position", "device-orientation", "add-checkpoint", "layer-checkpoints", "saved-checkpoints", "open-more",
    "sheet-more", "fit", "tool-center", "placement-center"])
    assert.equal(document.getElementById(id), null);
  assert.equal($("open-rotation").parentElement, $("display-chips"), "Rotation lives beside View in the top corner");
  assert.equal($("open-display").parentElement, $("display-chips"));
  for (const id of ["open-rotation", "open-display"]) {
    assert.equal($(id).querySelector("span"), null, "corner buttons show icons only");
    assert.ok($(id).getAttribute("aria-label"), "icon buttons have accessible names");
  }
  assert.equal(toolBar.hidden, true);
  assert.equal(tool(), "browse");

  // The pill holds every map tool, with the solid Saved and Add at its ends.
  assert.deepEqual([...dock.children].map((element) => element.id),
    ["open-saved", "open-search", "open-trail", "open-measure", "open-add"]);
  assert.equal($("search-field").hidden, true, "the search bar waits for its button");
  assert.equal($("map-search").parentElement, $("search-field"));
  // Rows are built only once their panel opens.
  assert.equal(document.getElementById("marker-list") ?? document.getElementById("route-list"), null);
  const refreshesBeforeOpening = labelRefreshes;
  focus.mock.resetCalls();
  click("open-saved");
  // Empty Saved lists show their status without offering their own button.
  for (const [id, message] of [
    ["marker-list", "No places yet. Hold the map to add one."],
    ["route-list", "No routes yet. Tap Add, then Route."],
  ] as const) {
    assert.equal($(id).querySelector("[data-empty]")!.textContent, message);
    assert.equal($(id).querySelector("button"), null);
  }
  assert.equal(focus.mock.callCount(), 0, "opening a panel does not preselect its close button");
  assert.ok(labelRefreshes > refreshesBeforeOpening, "opening a panel refreshes labels on an idle map");
  assert.equal(sheet.hidden, false);
  assert.equal($("sheet-saved").hidden, false);
  assert.equal($("sheet-display").hidden, true);
  assert.equal(text("sheet-title"), "Saved");
  assert.equal(gone("share-saved"), false);
  assert.equal($("share-saved").parentElement, $("sheet-title").parentElement, "share sits beside the title");
  assert.equal($("share-saved").getAttribute("aria-label"), "Share map or selected items");
  for (const id of ["route-list", "marker-list"]) {
    const list = $(id);
    assert.equal(list.tagName, "UL");
    assert.equal(list.firstElementChild?.tagName, "LI");
    assert.ok(document.getElementById(list.getAttribute("aria-labelledby")!));
  }
  assert.equal(sheet.dataset.panel, "saved", "panel takes its button's color");
  assert.equal($("open-saved").getAttribute("aria-expanded"), "true");
  assert.equal(dock.hidden, true, "an open panel takes the pill's place");
  // Add opens a panel like Saved, and its button stays + while it is open.
  focus.mock.resetCalls();
  click("open-add");
  assert.equal(focus.mock.callCount(), 0, "opening Add does not preselect Place");
  assert.equal(sheet.hidden, false);
  assert.equal(sheet.dataset.panel, "add");
  assert.equal(text("sheet-title"), "Add");
  assert.equal($("sheet-add").hidden, false);
  assert.equal($("sheet-saved").hidden, true);
  assert.equal($("open-saved").getAttribute("aria-expanded"), "false");
  assert.equal($("open-add").getAttribute("aria-expanded"), "true");
  assert.equal($("open-add").getAttribute("aria-label"), "Add");
  click("open-add");
  assert.equal(sheet.hidden, true, "Add toggles its panel");
  click("open-add");
  click("open-saved");
  assert.equal($("sheet-add").hidden, true, "a panel replaces the choice");
  click("close-sheet");
  click("open-display");
  assert.equal(text("sheet-title"), "View");
  assert.equal(gone("share-saved"), true, "sharing appears only in Saved");
  assert.equal($("sheet-dismiss").hidden, false);
  click("open-display");
  assert.equal(sheet.hidden, true);
  click("open-display");
  assert.equal(dock.hidden, true, "top panels hide the pill too");
  click("sheet-dismiss");
  assert.equal(sheet.hidden, true);
  assert.equal(dock.hidden, false, "closing a panel brings the pill back");

  // Brightness offers five persistent choices, with 85% selected by default.
  assert.equal(state.dimming, 0.85);
  assert.equal($<HTMLInputElement>("brightness-85").checked, true);
  const brightnessOptions = [100, 85, 75, 65, 55];
  for (const percent of brightnessOptions) {
    pick(`brightness-${percent}`);
    assert.equal(state.dimming, percent / 100);
    for (const option of brightnessOptions)
      assert.equal($<HTMLInputElement>(`brightness-${option}`).checked, option === percent);
    await controls.flush();
    assert.equal((await loadNavigation("controls")).dimming, percent / 100);
  }

  // Smart dark mode is on by default and set from View.
  assert.equal(state.inverted, true);
  assert.equal($<HTMLInputElement>("dark-map").checked, true);
  controls.options().onAppearance?.({ filter: "", kind: "already-dark" });
  assert.equal(text("dark-status"), "Map is already dark");
  pick("dark-map", false);
  assert.equal(state.inverted, false);
  assert.equal(text("dark-status"), "Off: original colors");
  pick("dark-map", true);
  assert.equal(state.inverted, true);

  // The corner Rotation button opens a panel of modes, like View.
  assert.equal($("open-rotation").getAttribute("aria-label"), "Rotation: Locked");
  click("open-rotation");
  assert.equal(sheet.hidden, false);
  assert.equal(text("sheet-title"), "Rotation");
  assert.equal($("open-rotation").getAttribute("aria-expanded"), "true");
  assert.equal($<HTMLInputElement>("rotation-locked").checked, true);
  assert.equal($("north-field").hidden, true, "north only matters to Compass mode");
  pick("rotation-free");
  assert.equal(state.rotationMode, "free");
  assert.equal($("open-rotation").getAttribute("aria-label"), "Rotation: Manual");
  assert.equal($<HTMLInputElement>("compass-follow-auto").checked, false, "a compass tile is only chosen in Compass mode");
  assert.equal($("rotation-help").hidden, true, "each row explains its mode, so the line below waits for the compass");
  assert.equal($("speed-field").hidden, true, "speeds only show under a chosen Auto");
  // Reset sits beside Close and turns the map back to 0°.
  assert.equal(gone("reset-rotation"), false);
  assert.equal($("reset-rotation").nextElementSibling, $("close-sheet"));
  click("reset-rotation");
  assert.equal(straightened, 1);

  // A compass tile turns on Compass mode and asks for the compass; tapping it again retries a refusal.
  let permission: PermissionState = "denied";
  Object.defineProperty(globalThis, "DeviceOrientationEvent", {
    value: { requestPermission: async () => permission },
    configurable: true,
  });
  t.after(() => delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent);
  pick("compass-follow-auto");
  assert.equal(state.rotationMode, "compass");
  assert.equal($<HTMLInputElement>("rotation-free").checked, false);
  assert.equal(gone("reset-rotation"), true, "the compass owns the angle in Compass mode");
  await settle();
  assert.match(text("rotation-help"), /access is off/);
  heading(90);
  assert.ok(orientations.every((rotation) => rotation === undefined), "a refused compass is not followed");
  permission = "granted";
  click("compass-follow-auto");
  await settle();
  assert.match(text("rotation-help"), /Looking for the compass/);
  // Facing east, the map's north turns to the left of the screen.
  heading(90);
  assert.equal(orientations.at(-1), -Math.PI / 2);
  assert.equal($("rotation-help").hidden, true, "a working compass needs no status");
  // By default (Mid) a 2° turn is followed once it has held for 1 s.
  const turnedTo = (degrees: number, within = 1e-9) =>
    Math.abs(orientations.at(-1)! + (degrees * Math.PI) / 180) < within;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal($<HTMLInputElement>("compass-follow-auto").checked, true);
  assert.equal($<HTMLInputElement>("compass-speed-mid").checked, true);
  assert.equal($("speed-field").hidden, false);
  heading(91);
  tick(5000);
  assert.equal(orientations.at(-1), -Math.PI / 2, "a 1° sway is left alone");
  heading(92);
  tick(999);
  assert.equal(orientations.at(-1), -Math.PI / 2);
  tick(1);
  assert.ok(turnedTo(92));
  heading(90);
  tick(1000);
  // Walking sways the phone; within 15° that still holds, and the map turns to the average.
  const following = orientations.length;
  heading(110);
  tick(250);
  heading(100);
  tick(250);
  heading(115);
  tick(250);
  heading(105);
  tick(249);
  assert.equal(orientations.length, following, "a turn in progress is not followed");
  tick(1);
  assert.ok(turnedTo(107.5, 0.01), "it turns to the average of the hold");
  // Turning past the window restarts the wait.
  heading(140);
  tick(750);
  heading(160);
  tick(750);
  assert.ok(turnedTo(107.5, 0.01));
  tick(250);
  assert.ok(turnedTo(160));
  // A heading that returns averages back to where the map is, so it stays put.
  const settled = orientations.length;
  heading(165);
  heading(157);
  heading(158);
  tick(5000);
  assert.equal(orientations.length, settled, "a heading that returns is not followed");
  // High waits half a second, and the device keeps the choice for every map.
  pick("compass-speed-high");
  assert.equal(localStorage.getItem("megamaps:compass-speed"), "high");
  assert.equal($<HTMLInputElement>("compass-speed-mid").checked, false);
  assert.match(text("speed-help"), /after 0\.5 s/);
  heading(90);
  tick(499);
  assert.ok(turnedTo(160));
  tick(1);
  assert.ok(turnedTo(90));
  // Live follows every 2° turn at once.
  pick("compass-speed-live");
  assert.match(text("speed-help"), /Instant\..*battery/);
  heading(91);
  assert.ok(turnedTo(90), "Live still leaves a 1° sway alone");
  heading(93);
  assert.ok(turnedTo(93));
  // Tap keeps the map still until a double tap turns it.
  pick("compass-follow-tap");
  assert.equal($("speed-field").hidden, true, "Tap has no speed");
  assert.equal($("north-field").hidden, false, "Tap still lines up with north");
  heading(180);
  tick(5000);
  assert.ok(turnedTo(93), "Tap never turns by itself");
  controls.options().onDoubleTap?.();
  assert.ok(turnedTo(180));
  pick("compass-follow-auto");
  pick("compass-speed-mid");
  heading(90);
  tick(1000);
  assert.ok(turnedTo(90));
  heading(200);
  controls.options().onDoubleTap?.();
  assert.ok(turnedTo(90), "outside Tap, a double tap does nothing");
  localStorage.removeItem("megamaps:compass-follow");
  localStorage.removeItem("megamaps:compass-speed");
  t.mock.timers.reset();

  // Its north offset fixes a map whose top isn't north; the wheel turns it as each degree passes.
  assert.equal($("north-field").hidden, false);
  assert.equal(text("north-label"), "North offset");
  const wheel = $("north-offset");
  const row = 32, zero = 179;
  const scrollWheel = (top: number) => {
    wheel.scrollTop = top;
    fire(wheel, "scroll");
  };
  assert.equal(wheel.scrollTop, zero * row, "the wheel opens on 0°");
  assert.equal(wheel.querySelector("[data-selected]")!.textContent, "0°");
  scrollWheel((zero + 5) * row + 10);
  assert.equal(state.northOffset, 5);
  assert.equal(wheel.scrollTop, (zero + 5) * row + 10, "a scrolling wheel is left where the finger is");
  assert.equal(wheel.getAttribute("aria-valuenow"), "5");
  assert.ok(Math.abs(orientations.at(-1)! + (95 * Math.PI) / 180) < 1e-9);
  scrollWheel(0);
  assert.equal(wheel.querySelector("[data-selected]")!.textContent, "−179°");
  scrollWheel((zero + 180) * row);
  assert.equal(state.northOffset, 180);
  await controls.flush();
  const saved = await loadNavigation("controls");
  assert.equal(saved.rotationMode, "compass");
  assert.equal(saved.northOffset, 180);

  // Locked stops following the phone.
  pick("rotation-locked");
  assert.equal(orientations.at(-1), undefined);
  const followed = orientations.length;
  heading(180);
  assert.equal(orientations.length, followed);
  assert.equal($("north-field").hidden, true);
  assert.equal($<HTMLInputElement>("compass-follow-auto").checked, false);
  assert.equal(gone("reset-rotation"), false);
  click("close-sheet");
  assert.equal(sheet.hidden, true, "reset belongs to the Rotation panel");

  // Places: pick Place, tap the map, save the prefilled card.
  click("open-add");
  click("add-marker");
  assert.equal(sheet.hidden, true);
  // The task card takes the pill's place, with the panels' header and X.
  assert.equal(dock.hidden, true);
  assert.equal(toolBar.hidden, false);
  assert.equal(text("tool-title"), "New place");
  assert.equal(text("tool-message"), "Tap the map where it goes");
  assert.equal(gone("tool-actions"), true, "a place needs no buttons");
  assert.equal(gone("tool-rename"), true, "only routes are renamed here");
  assert.equal($("tool-cancel").getAttribute("aria-label"), "Cancel");
  assert.equal($("open-add").getAttribute("aria-label"), "Add", "Add never turns into X");
  assert.equal($<HTMLButtonElement>("open-display").disabled, true);
  assert.equal($<HTMLInputElement>("map-search").disabled, true, "search waits until placing is over");
  assert.equal(tool(), "marker");
  tap(500, 600);
  assert.equal(isOpen("marker-dialog"), true);
  assert.equal(value("marker-label"), "", "the name starts empty");
  assert.equal($<HTMLInputElement>("marker-label").placeholder, "Point of interest", "hinting the kind, with no number");
  assert.deepEqual(previews.at(-1), { point: { x: 500, y: 600 }, kind: "landmark" }, "the new pin shows where it goes");
  assert.deepEqual(reveals.at(-1), { x: 500, y: 600 }, "the map keeps the spot clear of the card");
  assert.equal($("marker-dialog").style.getPropertyValue("--spot-y"), "300px", "and the scrim lights it");
  assert.notEqual(document.activeElement, $("marker-label"), "no keyboard just to accept the hinted name");
  assert.equal($<HTMLButtonElement>("marker-save").disabled, false, "the hint is enough to save");
  assert.equal(gone("marker-move"), true, "a new place has nothing to move yet");
  assert.equal($("kind-dialog").querySelectorAll(".place-icon > .place-pin").length, 12, "kinds show the map's pins");
  const kindInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[name="marker-kind"]')];
  assert.deepEqual(kindInputs().map((input) => input.value),
    ["landmark", "entrance", "shaft", "passage", "room", "unstable", "flooded", "ossuary", "sculpture", "graffiti", "tools", "squat"],
    "landmarks and bookmarks share one option");
  assert.equal(text("marker-kind-current"), "Point of interest", "the form shows only the chosen pin");
  click("marker-kind-toggle");
  assert.equal(isOpen("kind-dialog"), true, "tapping it opens every pin in a modal");
  assert.equal(document.querySelector('input[name="marker-kind"][value="unstable"]')!.closest("label")!.textContent!.trim(), "Danger",
    "each pin is named");
  const entrance = document.querySelector<HTMLInputElement>('input[name="marker-kind"][value="entrance"]')!;
  click(entrance);
  assert.equal(isOpen("kind-dialog"), false, "picking a pin goes back to the form");
  assert.equal(text("marker-kind-current"), "Entrance", "and the field shows it");
  assert.equal($<HTMLInputElement>("marker-label").placeholder, "Entrance", "the hint follows the kind");
  assert.deepEqual(previews.at(-1), { point: { x: 500, y: 600 }, kind: "entrance" });
  assert.equal($("marker-dialog").style.getPropertyValue("--c"), "#7dff8a", "the card takes the chosen pin's colour");
  assert.equal($("marker-dialog-title-icon").querySelector(".place-icon > .place-pin")!.getAttribute("fill"), "#7dff8a",
    "and its title shows the chosen pin");
  type("marker-label", "<Entrance>");
  type("marker-description", "Left opening");
  submit("marker-form");
  assert.equal(state.markers[0]?.label, "<Entrance>");
  assert.equal(state.markers[0]?.kind, "entrance");
  assert.deepEqual(state.markers[0]?.point, { x: 500, y: 600 });
  assert.equal(isOpen("marker-dialog"), false);
  assert.equal(previews.at(-1), undefined, "the saved pin replaces the preview");
  assert.equal(toolBar.hidden, true);
  assert.equal(dock.hidden, false);
  assert.equal($<HTMLButtonElement>("open-saved").disabled, false);
  assert.equal($<HTMLInputElement>("map-search").disabled, false);
  controls.options().onMarker(state.markers[0]!);
  assert.equal(pulses.at(-1), state.markers[0]!.id, "the place being read pulses");
  assert.deepEqual(jumps.at(-1), state.markers[0]!.point, "opening a place centers it in the map above its details");
  assert.equal(requestedZooms.at(-1), 1, "opening a place requests native detail zoom");
  assert.equal($("marker-form").hidden, true, "a place opens as information, not an editing form");
  assert.equal(text("marker-dialog-title"), "<Entrance>");
  assert.doesNotMatch($("marker-details").textContent!, /Entrance/, "the pin shows the type; the details don't spell it out");
  assert.equal(text("marker-detail-description"), "Left opening");
  assert.equal($("marker-details").hidden, false);
  assert.equal($("marker-details").querySelector("Entrance"), null, "place information remains literal text");
  assert.equal($("marker-edit").nextElementSibling, $("marker-cancel"), "Edit sits beside Close");
  click("marker-edit");
  assert.equal($("marker-form").hidden, false);
  assert.equal($("marker-details").hidden, true);
  type("marker-description", "Unsaved changes");
  // Putting the keyboard away must never leave the form or drop the typing.
  assert.equal(fire("marker-label", "keydown", { key: "Enter" }), false, "Next on the name does not submit the form");
  assert.equal(focus.mock.calls.at(-1)?.this, $("marker-description"), "Next on the name moves to the description");
  assert.equal(cancel("marker-dialog"), false, "a close request keeps the form open");
  assert.equal($("marker-form").hidden, false);
  assert.equal(value("marker-description"), "Unsaved changes");
  assert.equal(state.markers[0]?.description, "Left opening", "nothing is saved without Save");
  click("marker-cancel");
  assert.equal($("marker-form").hidden, false, "X with changes asks first");
  assert.ok(armed($("marker-cancel")));
  assert.equal($("marker-cancel").getAttribute("aria-label"), "Discard?");
  click("marker-cancel");
  assert.equal($("marker-form").hidden, true, "a second X discards and returns to reading");
  assert.equal($("marker-cancel").getAttribute("aria-label"), "Close", "and X is plain again");
  assert.equal(text("marker-detail-description"), "Left opening", "canceling leaves the original description intact");
  assert.equal(state.markers[0]?.description, "Left opening");
  click("marker-edit");
  assert.equal(entrance.checked, true);
  assert.equal(gone("marker-delete"), false);
  type("marker-description", "Updated description");
  submit("marker-form");
  assert.equal(state.markers[0]?.description, "Updated description");
  assert.equal(state.markers.length, 1);
  assert.equal($("marker-form").hidden, true, "saving returns to readable information");
  assert.equal(text("marker-detail-description"), "Updated description");
  click("marker-edit");
  type("marker-description", "");
  submit("marker-form");
  assert.equal($("marker-detail-description").hidden, true, "a cleared description leaves no gap");
  assert.equal(gone("marker-detail-log"), false, "its edits are still there to read");
  assert.equal(text("marker-detail-updated"), "Updated today", "the header still says how fresh it is");
  click("marker-cancel");
  assert.equal(isOpen("marker-dialog"), false);
  const openSaved = () => gone("sheet-saved") && click("open-saved");
  openSaved();
  // Saved list renders names as text, never markup.
  assert.match($("marker-list").textContent!, /<Entrance>/);
  assert.equal(text("saved-places-count"), "1");
  assert.equal($("marker-list").querySelector("[data-row]")?.tagName, "LI");
  // Saved is one list: a Routes section then a Places section, no tabs.
  assert.equal(document.querySelector("#sheet-saved [role=tab]"), null, "no tabs in Saved");
  assert.equal($("marker-list").querySelector("[data-row] .place-pin")?.getAttribute("fill"), "#7dff8a",
    "the row shows the entrance pin as drawn on the map");
  // A row's actions stay tucked behind ⋯, in a small sheet.
  const placeMore = () => $("marker-list").querySelector<HTMLButtonElement>("[data-menu]")!;
  assert.equal(rowSheet(), null);
  assert.match(placeMore().getAttribute("aria-label")!, /Actions for <Entrance>/);
  const originalMore = placeMore();
  focus.mock.resetCalls();
  click(originalMore);
  assert.equal(focus.mock.callCount(), 0, "opening row actions does not preselect the first action");
  assert.equal(placeMore(), originalMore, "opening a menu keeps the tapped row intact");
  assert.equal($("sheet-content").contains(rowSheet()), false, "the menu escapes the scroll container's clipping");
  assert.equal(rowSheet()!.querySelector("h2")!.textContent, "<Entrance>", "the sheet names what it acts on");
  assert.deepEqual(sheetActions().map((button) => button.textContent!.trim()), ["Edit", "Move", "Share", "Delete"]);
  click(sheetActions().find((button) => button.textContent!.trim() === "Share")!);
  assert.deepEqual(shares.at(-1), { kind: "marker", id: state.markers[0]!.id });
  assert.equal(state.markers.length, 1, "sharing does not modify the selected place");
  assert.equal(rowSheet(), null, "an action closes the sheet");
  click(placeMore());
  // Tapping the backdrop closes it.
  fire(rowSheet()!, "pointerdown");
  assert.notEqual(rowSheet(), null, "pressing the sheet does not close it before its click");
  click(rowSheet()!);
  assert.equal(rowSheet(), null);
  assert.equal(placeMore(), originalMore, "closing the sheet keeps the rows intact");
  const jump = $("marker-list").querySelector<HTMLButtonElement>("[data-row] button")!;
  fire(jump, "pointerdown");
  assert.equal(jump.isConnected, true);
  click(jump);
  assert.equal(sheet.hidden, true, "the same tap can still jump to the place");
  assert.deepEqual(jumps.at(-1), state.markers[0]!.point);
  assert.equal(pulses.at(-1), state.markers[0]!.id, "the place pulses once the map arrives");
  assert.equal(requestedZooms.at(-1), 1, "Saved places request the same detail zoom");
  assert.equal(isOpen("marker-dialog"), true, "Saved places open the same detail view");
  assert.equal($("marker-form").hidden, true);
  click("marker-cancel");
  click("open-saved");
  click(placeMore());
  click(rowSheet()!.querySelector<HTMLButtonElement>("[aria-label=Close]")!);
  assert.equal(rowSheet(), null, "the ✕ closes the sheet");
  click(placeMore());
  onWindow("resize");
  assert.equal(rowSheet(), null, "rotation/resize dismisses the menu");
  click(placeMore());
  click("close-sheet");
  click("open-saved");
  assert.equal(rowSheet(), null, "menus close with the panel");

  // Move lifts the pin: tap (or drag) where it goes; × puts it back.
  click(placeMore());
  click(sheetActions()[1]!);
  assert.equal(tool(), "move");
  assert.equal(tools.at(-1), "move");
  assert.equal(sheet.hidden, true);
  assert.equal(text("tool-message"), "Drag the pin, or tap where it goes");
  assert.equal(gone("route-undo"), true);
  assert.equal($<HTMLButtonElement>("tool-done").disabled, false);
  tap(700, 800);
  assert.deepEqual(state.markers[0]?.point, { x: 700, y: 800 });
  click("tool-cancel");
  assert.deepEqual(state.markers[0]?.point, { x: 500, y: 600 }, "× puts it back");
  assert.equal(tool(), "browse");
  click("open-saved");
  click(placeMore());
  click(sheetActions()[1]!);
  tap(700, 800);
  click("tool-done");
  assert.deepEqual(state.markers[0]?.point, { x: 700, y: 800 });
  assert.match(text("toast"), /<Entrance> moved/);

  // Routes start drawing immediately; Done needs two points.
  click("add-route");
  assert.equal(tools.at(-1), "route");
  assert.equal(state.routes.length, 1);
  assert.equal(state.routes[0]?.name, "Route 1");
  const done = () => $<HTMLButtonElement>("tool-done");
  assert.equal(gone("tool-actions"), false);
  assert.equal(done().disabled, true);
  assert.equal($<HTMLButtonElement>("route-undo").disabled, true);
  assert.equal(text("tool-message"), "Tap where the route starts");
  tap(900, 1000);
  assert.equal(text("tool-message"), "1 point · Tap where it goes next", "one point asks for the next");
  tap(1500, 1700);
  assert.equal(done().disabled, false);
  assert.equal(text("tool-message"), "2 points · Tap to add, drag to adjust");
  click("route-undo");
  assert.equal(state.routes[0]?.points.length, 1);
  assert.equal(done().disabled, true);
  tap(1400, 1600);
  assert.equal(text("tool-title"), "Route 1");
  // The pencil renames the route without leaving the drawing.
  assert.equal(gone("tool-rename"), false);
  click("tool-rename");
  type("name-input", "Lower loop");
  submit("name-form");
  assert.equal(text("tool-title"), "Lower loop");
  assert.equal(tool(), "route");
  // Dragging a point is one Undo step, like a tap.
  const options = controls.options();
  options.onDragStart?.();
  state.routes[0]!.points[0]!.x = 950;
  options.onDrop?.(true);
  click("route-undo");
  assert.equal(state.routes[0]?.points[0]?.x, 900);
  assert.equal(state.routes[0]?.points.length, 2);
  // An interrupted drag leaves no Undo step behind.
  options.onDragStart?.();
  options.onDrop?.(false);
  click("route-undo");
  assert.equal(state.routes[0]?.points.length, 1);
  tap(1400, 1600);
  click("tool-done");
  assert.equal(state.routes[0]?.draft, false);
  assert.equal(toolBar.hidden, true);
  assert.equal(tools.at(-1), "browse");
  openSaved();
  assert.equal($("route-list").querySelector("[data-row]")?.tagName, "LI");

  // Editing a finished route down to one point restores it.
  const routeMore = () => $("route-list").querySelector<HTMLButtonElement>("[data-menu]")!;
  const rowButton = (label: RegExp) => sheetActions().find((button) => label.test(button.textContent!.trim()))!;
  const editPoints = () => {
    openSaved();
    click(routeMore());
    click(rowButton(/^Edit points$/));
  };
  editPoints();
  assert.deepEqual(framed.at(-1), state.routes[0]!.points, "editing frames the route");
  click("route-undo");
  assert.equal(state.routes[0]?.points.length, 1);
  click("tool-done");
  assert.equal(state.routes[0]?.points.length, 2);
  assert.equal(state.routes[0]?.draft, false);

  // × cancels: a single point goes at once, real work asks twice.
  click("open-add");
  click("add-route");
  tap(100, 100);
  click("tool-cancel");
  assert.equal(state.routes.length, 1);
  assert.match(text("toast"), /discarded/);
  click("open-add");
  click("add-route");
  tap(100, 100);
  tap(200, 200);
  click("tool-cancel");
  assert.equal(state.routes.length, 2, "first × only asks");
  assert.equal($("tool-cancel").getAttribute("aria-label"), "Discard?");
  assert.ok(armed($("tool-cancel")));
  assert.equal(text("tool-message"), "Tap × again to discard this route");
  click("tool-cancel");
  assert.equal(state.routes.length, 1);
  assert.equal(tools.at(-1), "browse");
  // Cancelling an edit restores the route as it was.
  editPoints();
  tap(300, 300);
  click("tool-cancel");
  click("tool-cancel");
  assert.equal(state.routes[0]?.points.length, 2);
  assert.equal(state.routes[0]?.draft, false);
  assert.match(text("toast"), /unchanged/);

  // Saved route rows open the route's details, like a place's, and frame it.
  click("open-saved");
  click($("route-list").querySelector<HTMLButtonElement>("[data-row] button")!);
  assert.equal($("marker-dialog").dataset.mode, "view");
  assert.equal(text("marker-dialog-title"), "Lower loop");
  assert.equal($("marker-edit").getAttribute("aria-label"), "Edit route");
  assert.deepEqual(framed.at(-1), state.routes[0]!.points);
  click("marker-cancel");
  assert.equal(isOpen("marker-dialog"), false);

  // Edit uses the place form, delete needs two taps; all behind ⋯.
  const openMenu = () => {
    openSaved();
    if (!rowSheet()) click(routeMore());
  };
  openMenu();
  assert.deepEqual(sheetActions().map((button) => button.textContent!.trim()), ["Edit", "Edit points", "Share", "Delete"]);
  click(rowButton(/^Share$/));
  assert.deepEqual(shares.at(-1), { kind: "route", id: state.routes[0]!.id });
  click("share-saved");
  assert.equal(shares.at(-1), undefined, "the map-level action opens selection of all annotations");
  openMenu();
  click(rowButton(/^Edit$/));
  assert.equal(text("marker-dialog-title"), "Edit route");
  assert.equal($("marker-kinds").hidden, true, "a route's look comes from its line");
  type("marker-label", "Exit plan");
  type("marker-description", "Mind the low ceiling");
  submit("marker-form");
  assert.equal(state.routes[0]?.name, "Exit plan");
  assert.equal(state.routes[0]?.description, "Mind the low ceiling");
  assert.equal(isOpen("marker-dialog"), false, "opened from Saved, Save goes back there");
  await controls.flush();
  assert.equal((await loadNavigation("controls")).routes[0]?.name, "Exit plan");
  assert.equal(rowSheet(), null, "the menu closes after an action");
  openMenu();
  const deleteMenu = rowSheet();
  const routeRow = $("route-list").firstElementChild;
  click(rowButton(/^Delete$/));
  assert.equal(state.routes.length, 1);
  assert.equal(rowSheet(), deleteMenu, "confirmation keeps the same sheet in place");
  assert.ok(armed(rowButton(/Tap again/)), "an armed Delete fills red");
  assert.equal($("route-list").firstElementChild, routeRow, "confirmation leaves the scrollable rows intact");
  onWindow("resize");
  openMenu();
  assert.ok(rowButton(/^Delete$/), "reopening clears the pending delete label");
  click(rowButton(/^Delete$/));
  assert.equal(state.routes.length, 1, "reopening must require a fresh confirmation");
  click(rowButton(/Tap again/));
  assert.equal(state.routes.length, 0);
  assert.equal(rowSheet(), null, "deleting closes the sheet");
  assert.equal(text("toast"), "Exit plan deleted");

  // Layers hide/show.
  assert.equal(text("layer-places-count"), "1");
  pick("layer-places", false);
  assert.equal(state.layers.places, false);

  // Search stays usable while OCR runs, then reveals every matching location.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const searching = () => !$("search-field").hidden;
  click("open-search");
  assert.equal($("open-search").getAttribute("aria-expanded"), "true");
  assert.equal(dock.hidden, true, "the search bar takes the pill's place");
  assert.equal(sheet.hidden, true, "search is a bar above the pill rather than a panel");
  assert.equal(searching(), true, "the field opens above the pill");
  assert.equal($("search-field").querySelectorAll("button").length, 2, "the count, which is also Next, and Close");
  assert.equal($("search-status").closest("[hidden]"), null, "search status stays available to screen readers");
  assert.equal($("search-count").parentElement, $("map-search").parentElement);
  assert.equal($("search-count").hidden, true);
  assert.equal($("sheet-dismiss").hidden, true, "search leaves the canvas available for gestures");
  controls.updateOcr(undefined, "Detecting map text · 10%", 0.1, "4 min left");
  assert.equal(text("ocr-percent"), "10% · 4 min left", "the scan's time left shows beside its percentage");
  assert.equal($("ocr-progress").hidden, false);
  controls.updateOcr(undefined, "Detecting map text · 10%");
  assert.equal($("ocr-progress").hidden, true);
  type("map-search", "north");
  assert.equal(highlights?.active, false, "no masking before OCR is ready");
  assert.match(text("search-status"), /10%/);
  const polygon = [{ x: 100, y: 200 }, { x: 180, y: 200 }, { x: 180, y: 220 }, { x: 100, y: 220 }];
  const index = {
    mapId: map.id, version: 1, completedAt: 1,
    lines: [{ text: "North", confidence: 90, words: [{ text: "North", polygon }] }],
  };
  controls.updateOcr(index);
  assert.equal(highlights?.active, false, "OCR arriving during typing preserves the debounce");
  onScreen = false;
  tick(200);
  onScreen = true;
  assert.deepEqual(framed.at(-1), polygon, "a result nowhere on screen is brought into view");
  assert.equal(highlights?.active, true);
  assert.equal(highlights?.matches.length, 1);
  fire("map-canvas", "pointerdown");
  assert.equal(searching(), true, "touching the map keeps search open");
  assert.equal(value("map-search"), "north");
  assert.equal(highlights?.active, true, "map gestures keep the matches highlighted");
  assert.match(text("search-status"), /1 match/);
  assert.equal(text("search-count"), "1 match");
  assert.equal($("search-count").hidden, false);
  assert.equal($("search-count").getAttribute("aria-label"), "1 result");
  click("map-search");
  click("search-count");
  assert.equal(searching(), true, "clicking inside the search field keeps it open");
  assert.equal(highlights?.active, true);
  click("map-canvas");
  assert.equal(searching(), true, "map clicks keep search open");
  assert.equal(dock.hidden, true, "the pill waits until search closes");
  assert.equal(highlights?.active, true, "map clicks preserve search highlights");
  assert.equal(value("map-search"), "north");
  click("search-close");
  assert.equal(searching(), false, "Close in the field ends Search");
  assert.equal($("open-search").getAttribute("aria-expanded"), "false");
  assert.equal(dock.hidden, false);
  assert.equal(value("map-search"), "");
  focus.mock.resetCalls();
  click("open-search");
  assert.equal(focus.mock.callCount(), 1, "tapping Search opens it ready to type");
  assert.equal(searching(), true);
  type("map-search", "north");
  tick(200);
  enter();
  assert.deepEqual(framed.at(-1), polygon);
  controls.updateOcr(index, "Detecting map text · 20%");
  assert.equal(text("search-count"), "1 match", "progress keeps the selected result");
  const secondPolygon = polygon.map(({ x, y }) => ({ x: x + 500, y }));
  const multiple = {
    ...index,
    completedAt: 2,
    lines: [...index.lines, { text: "North entrance", confidence: 90, words: [{ text: "North", polygon: secondPolygon }] }],
  };
  const frameCount = framed.length;
  controls.updateOcr(multiple);
  assert.equal(framed.length, frameCount, "previewing a match leaves the map in place");
  assert.equal(text("search-count"), "2 matches");
  enter();
  enter();
  assert.deepEqual(framed.at(-1), secondPolygon);
  assert.equal(highlights?.selected, 1, "the overlay emphasizes the navigated result");
  assert.equal(text("search-count"), "2 / 2", "the count shows where you are");
  assert.match(text("search-status"), /^Match 2 of 2/);
  controls.updateOcr(multiple, "Detecting map text · 30%");
  assert.equal(highlights?.selected, 1, "OCR progress preserves the overlay selection");
  assert.equal(text("search-count"), "2 / 2", "progress keeps the current match");
  controls.updateOcr(structuredClone(multiple));
  assert.equal(text("search-count"), "2 / 2", "the same scan read again from storage keeps the current match");
  enter();
  assert.deepEqual(framed.at(-1), polygon, "next wraps to the first match");
  // The count steps on once the keyboard is away.
  click("search-count");
  assert.deepEqual(framed.at(-1), secondPolygon, "the count is a Next button");
  assert.equal(text("search-count"), "2 / 2");
  assert.equal($("search-count").getAttribute("aria-label"), "Match 2 of 2. Next match");
  assert.equal(searching(), true);
  // Tapping a result's label on the map flies there and keeps every match.
  controls.options().onSearchResult?.(0);
  assert.deepEqual(framed.at(-1), polygon);
  assert.equal(highlights?.selected, 0);
  assert.equal(highlights?.matches.length, 2);
  assert.equal(text("search-count"), "1 / 2");
  type("map-search", "unknown");
  assert.equal(highlights?.matches.length, 2, "typing keeps the previous search until the debounce settles");
  tick(199);
  assert.equal(highlights?.matches.length, 2);
  tick(1);
  assert.equal(highlights?.matches.length, 0);
  assert.equal(highlights?.active, true);
  assert.match(text("search-status"), /No matching/);
  assert.equal(text("search-count"), "No matches");
  assert.equal($("search-count").hidden, false);
  assert.equal($<HTMLButtonElement>("search-count").disabled, true, "nothing to step to");
  type("map-search", "q");
  tick(200);
  assert.match(text("search-status"), /^Keep typing to search the map’s text\./,
    "one letter searches only saved places, and says so");
  // A double search keeps the results of both searches that meet.
  type("map-search", "north; south");
  tick(200);
  assert.equal(text("search-count"), "No matches");
  const southPolygon = polygon.map(({ x, y }) => ({ x, y: y + 30 }));
  controls.updateOcr({ ...multiple, completedAt: 3, lines: [...multiple.lines,
    { text: "South", confidence: 90, words: [{ text: "South", polygon: southPolygon }] }] });
  assert.equal(text("search-count"), "1 match");
  assert.deepEqual(highlights?.matches[0]?.midpoint, { x: 140, y: 225 });
  click("search-count");
  assert.deepEqual(framed.at(-1), [...polygon, ...southPolygon, { x: 140, y: 225 }], "both results come into view");
  controls.updateOcr(multiple);
  type("map-search", "");
  assert.equal(highlights?.active, false);
  assert.equal($("search-count").hidden, true);
  type("map-search", "north");
  click("map-stage");
  tick(200);
  assert.equal(highlights?.active, true, "map clicks do not cancel a pending query");
  type("map-search", "unknown");
  click("search-close");
  assert.equal(highlights?.active, false, "closing search restores the map");
  assert.equal(dock.hidden, false);
  tick(200);
  assert.equal(highlights?.active, false, "closing cancels the pending search");

  // Saved places work independently of text detection and layer visibility.
  const originalMarkers = [...state.markers];
  const landmarks = Array.from({ length: 30 }, (_, i) => ({
    id: `search-place-${i}`, kind: "landmark" as const,
    label: i ? `Église ${i}` : "<Église>", description: "North entrance",
    point: { x: 400 + i * 100, y: 500 }, created: i,
  }));
  state.markers.push(...landmarks);
  controls.updateOcr(undefined, "Detecting map text · 40%");
  click("open-search");
  type("map-search", "egl");
  tick(100);
  type("map-search", "eglise");
  tick(100);
  assert.equal(highlights?.matches.length, 0, "each keystroke restarts the debounce");
  tick(100);
  assert.equal(highlights?.matches.length, 30);
  assert.equal(highlights?.active, true, "saved places highlight while OCR is pending and Places is hidden");
  assert.equal(text("search-count"), "30 matches", "the badge counts every matching location");
  assert.equal($("search-count").getAttribute("aria-label"), "30 results");
  enter();
  assert.deepEqual(jumps.at(-1), landmarks[0]!.point);
  enter();
  assert.deepEqual(jumps.at(-1), landmarks[1]!.point);
  assert.equal(highlights?.selected, 1);
  controls.updateOcr(undefined, "Detecting map text · 50%");
  assert.equal(highlights?.selected, 1, "progress preserves saved-place selection");
  type("map-search", "north");
  enter();
  assert.equal(highlights?.matches.length, 30, "Enter immediately searches the latest query, including notes");
  assert.equal(highlights?.selected, 0);
  type("map-search", "unknown");
  type("map-search", "");
  tick(200);
  assert.equal(highlights?.active, false, "clear cancels a pending query");
  click("search-close");
  assert.equal(dock.hidden, false, "closing search restores the navbar");
  state.markers = originalMarkers;

  // Long-press opens the wheel; lifting in its middle does nothing.
  const hold = (screen = { x: 200, y: 300 }) => controls.options().onHold!({ x: 2000, y: 2100 }, screen)!;
  let press = hold();
  assert.equal($("hold-wheel").hidden, false);
  press.move({ x: 200, y: 230 });
  assert.equal($("hold-wheel").dataset.choice, "place");
  press.move({ x: 215, y: 310 });
  assert.equal($("hold-wheel").dataset.choice, undefined, "back in the middle, nothing is chosen");
  press.end({ x: 215, y: 310 });
  assert.equal($("hold-wheel").hidden, true);
  assert.equal(isOpen("marker-dialog"), false);
  assert.equal(state.trail.length, 0);
  // Down, even well to one side, marks the trail at the pressed point, with an Undo.
  press = hold();
  press.end({ x: 290, y: 360 });
  assert.equal(state.trail.length, 1);
  assert.deepEqual({ ...state.trail[0], time: 0 }, { x: 2000, y: 2100, time: 0 });
  assert.equal(text("toast"), "Trip started", "the first point starts a trip");
  click("toast-undo");
  assert.equal(state.trail.length, 0);
  // A cancelled hold (a second finger) does nothing.
  press = hold();
  press.move({ x: 200, y: 200 });
  press.end();
  assert.equal(isOpen("marker-dialog"), false);
  // Up drops a place.
  hold().end({ x: 180, y: 240 });
  assert.equal(isOpen("marker-dialog"), true);
  assert.equal($<HTMLInputElement>("marker-label").placeholder, "Entrance", "a new place starts as the kind last added");
  assert.deepEqual(previews.at(-1), { point: { x: 2000, y: 2100 }, kind: "entrance" });
  submit("marker-form");
  assert.deepEqual(state.markers.at(-1)?.point, { x: 2000, y: 2100 });
  assert.equal(state.markers.at(-1)?.kind, "entrance");
  assert.equal(state.markers.at(-1)?.label, "Entrance", "an empty name saves as the hint, even if another place has it");
  assert.equal(text("toast"), "Entrance saved");
  assert.equal($("toast-bar").dataset.tone, "done");
  tick(2300);
  assert.equal($("toast-bar").hidden, true, "a short one goes soon");
  // Toasts stay up for as long as they take to read.
  controls.options().onMarker(state.markers.at(-1)!);
  click("marker-edit");
  type("marker-label", "Lower entrance past the flooded quarry hall west");
  submit("marker-form");
  assert.equal(text("toast"), "Lower entrance past the flooded quarry hall west updated");
  tick(4200);
  assert.equal($("toast-bar").hidden, false, "a longer toast stays up longer");
  tick(200);
  assert.equal($("toast-bar").hidden, true);
  t.mock.timers.reset();

  // Editing keeps a place's spot in the list and says when nothing changed.
  const order = () => state.markers.map((marker) => marker.label);
  const before = order();
  assert.ok(before.length > 1);
  controls.options().onMarker(state.markers[0]!);
  click("marker-edit");
  submit("marker-form");
  assert.equal(text("toast"), `${before[0]} unchanged`);
  assert.equal($("toast-bar").dataset.tone, "quiet", "nothing changed reads as neutral");
  controls.options().onMarker(state.markers[0]!);
  click("marker-edit");
  type("marker-label", "Upper exit");
  submit("marker-form");
  assert.equal(text("toast"), "Upper exit updated");
  assert.deepEqual(order(), ["Upper exit", ...before.slice(1)]);

  // Move on the card keeps the typed edits, then lifts the pin.
  controls.options().onMarker(state.markers[0]!);
  click("marker-edit");
  assert.equal(gone("marker-move"), false, "an existing place can move from its card");
  type("marker-label", "Upper exit");
  click("marker-move");
  assert.equal(tools.at(-1), "move");
  assert.equal(isOpen("marker-dialog"), false);
  assert.equal(state.markers[0]?.label, "Upper exit");
  assert.equal(text("tool-title"), "Upper exit");
  click("tool-cancel");
  assert.equal(tools.at(-1), "browse");
  assert.deepEqual(order(), ["Upper exit", ...before.slice(1)]);

  // The card's Delete takes two taps, like the Saved menu's.
  controls.options().onMarker(state.markers[0]!);
  click("marker-edit");
  click("marker-delete");
  assert.equal(state.markers.length, before.length, "one tap only arms Delete");
  assert.equal(text("marker-delete"), "Tap again");
  assert.ok(armed($("marker-delete")), "armed Delete fills red");
  controls.options().onMarker(state.markers[0]!);
  click("marker-edit");
  assert.equal(text("marker-delete"), "Delete", "reopening the card disarms it");
  click("marker-delete");
  click("marker-delete");
  assert.equal(state.markers.length, before.length - 1);
  assert.equal(text("toast"), "Upper exit deleted");
  // Undo puts it back where it was in the list.
  assert.equal(gone("toast-undo"), false, "a delete offers Undo");
  assert.equal($("toast-bar").dataset.tone, "removed");
  click("toast-undo");
  assert.deepEqual(order(), ["Upper exit", ...before.slice(1)]);
  assert.equal(text("toast"), "Upper exit restored");
  assert.equal(gone("toast-undo"), true, "Undo is offered once");
});

test("place details read long descriptions safely", async (t) => {
  const map = mapRecord("place-reading");
  const state = defaultNavigation(map.id);
  const note = "<img src=x onerror=alert(1)>\n" + "A detailed observation.\n".repeat(150);
  const marker = {
    id: "reading-place", point: { x: 500, y: 600 }, label: "<Entrance>",
    description: note, kind: "entrance" as const, created: 0,
  };
  state.markers = [marker];
  const original = structuredClone(marker);
  const covers: (number | undefined)[] = [];
  const controls = openMap(t, map, state, { cover(edge) { covers.push(edge); } });
  const details = $("marker-details"), noteElement = $("marker-detail-description");
  Object.defineProperty($("marker-dialog"), "offsetTop", { value: 420 });
  // Nothing is laid out here: the details are 2000px tall in a 500px window.
  let contentHeight = 2000, top = 0;
  Object.defineProperties(details, {
    scrollHeight: { get: () => contentHeight },
    clientHeight: { value: 500 },
    scrollTop: { get: () => top, set: (value: number) => { top = value; } },
  });
  // A chevron over a fade hints there is more below.
  const more = () => details.nextElementSibling!.classList.contains("opacity-100");
  const scroll = (to: number) => {
    details.scrollTop = to;
    fire(details, "scroll");
  };
  controls.options().onMarker(marker);
  assert.equal(covers.at(-1), 420, "the map stays full size; the pane only covers it");
  assert.equal(more(), true, "longer details hint there is more below");
  scroll(1000);
  assert.equal(more(), true);
  scroll(1500);
  assert.equal(more(), false, "the hint goes once the end is reached");
  scroll(1200);
  assert.equal(more(), true, "and returns when scrolling back up");
  assert.equal($("marker-form").hidden, true);
  assert.equal(noteElement.textContent, note, "long notes retain every line");
  assert.equal(noteElement.querySelector("img"), null, "notes cannot inject markup");
  assert.deepEqual(state.markers[0], original, "reading does not modify the place");
  contentHeight = 300;
  const short = { ...marker, id: "short-place", description: "A short note." };
  const bare = { ...marker, id: "bare-place", description: "" };
  state.markers.push(short, bare);
  controls.options().onMarker(short);
  assert.equal(details.scrollTop, 0, "another place starts at the top");
  assert.equal(more(), false, "details that fit need no hint");
  controls.options().onMarker(bare);
  assert.equal(details.hidden, true, "a place with nothing to read is just its header");
  assert.equal(noteElement.hidden, true, "a place without a description shows none");
  click("marker-cancel");
  assert.equal(isOpen("marker-dialog"), false);
  assert.equal(covers.at(-1), undefined, "closing the pane uncovers the map");
});

test("reading a place leaves the map usable and closes when tapping away", async (t) => {
  const map = mapRecord("place-dismiss");
  const state = defaultNavigation(map.id);
  const marker = {
    id: "dismiss-place", point: { x: 500, y: 600 }, label: "Entrance",
    description: "", kind: "entrance" as const, created: 0,
  };
  state.markers = [marker];
  const selected: (string | undefined)[] = [];
  const controls = openMap(t, map, state, { select(id) { selected.push(id); } });
  const card = $<HTMLDialogElement>("marker-dialog");
  const opened: boolean[] = [];
  const { show, showModal } = card;
  card.show = () => { opened.push(false); show.call(card); };
  card.showModal = () => { opened.push(true); showModal.call(card); };
  controls.options().onMarker(marker);
  assert.deepEqual(opened, [false], "the map behind stays usable to pan and zoom");
  assert.equal(selected.at(-1), marker.id, "the place being read is highlighted");
  fire("map-canvas", "pointerdown");
  fire("marker-dialog-title", "pointerdown");
  assert.equal(card.open, true, "pressing the map may start a pan; the card stays");
  controls.options().onEmptyTap!();
  assert.equal(card.open, false, "tapping the map closes it");
  assert.equal(selected.at(-1), undefined);
  controls.options().onMarker(marker);
  fire("open-saved", "pointerdown");
  assert.equal(card.open, false, "pressing other controls closes it");
  controls.options().onMarker(marker);
  click("marker-edit");
  assert.deepEqual(opened.slice(-2), [false, true], "editing is modal");
  assert.equal(selected.at(-1), marker.id, "switching to editing keeps the place");
  controls.options().onEmptyTap!();
  assert.equal(card.open, true, "taps behind the editor don't close it");
  click("marker-cancel");
  assert.deepEqual(opened.slice(-1), [false], "cancelling returns to the readable, non-modal details");
  assert.equal(text("marker-dialog-title"), "Entrance");
});

test("place photos lead the details as a carousel and are removed from the edit form", async (t) => {
  const map = mapRecord("place-photos");
  const first = await savePhoto(map.id, new Blob(["first"], { type: "image/jpeg" }));
  const second = await savePhoto(map.id, new Blob(["second"], { type: "image/jpeg" }));
  const state = defaultNavigation(map.id);
  state.markers = [{
    id: "pillar", point: { x: 500, y: 600 }, label: "Pillar", description: "Cracked",
    photos: [second, first], kind: "unstable", created: 0,
  }];
  const controls = openMap(t, map, state);
  controls.options().onMarker(state.markers[0]!);
  const carousel = $("marker-detail-photos");
  const images = () => [...carousel.querySelectorAll("img")];
  assert.equal(carousel.hidden, false);
  assert.equal(carousel.parentElement!.firstElementChild, carousel, "photos come first in the details");
  assert.deepEqual(images().map((image) => image.alt), ["Photo 1 of 2", "Photo 2 of 2"]);
  await until(() => images().every((image) => image.getAttribute("src")?.startsWith("blob:")));
  assert.ok(images().every((image) => image.getAttribute("src")?.startsWith("blob:")));

  click(carousel.querySelectorAll("button")[1]!);
  assert.equal(isOpen("photo-viewer"), true, "tapping a photo shows it full screen");
  assert.deepEqual([...$("photo-viewer").querySelectorAll<HTMLImageElement>(".photo-viewer-track img")].map((image) => image.alt),
    ["Photo 1 of 2", "Photo 2 of 2"], "the place's other photos are a swipe away");
  click("photo-viewer-close");
  assert.equal(isOpen("photo-viewer"), false);
  assert.equal(isOpen("marker-dialog"), true, "closing the photo returns to the place");

  click("marker-edit");
  await settle();
  assert.equal($("marker-photo-list").querySelectorAll("img").length, 2);
  assert.equal($("marker-photo-list").lastElementChild!.contains($("marker-add-photos")), true, "adding is the last tile");
  click($("marker-photo-list").querySelector<HTMLElement>("[data-remove]")!);
  submit("marker-form");
  assert.deepEqual(state.markers[0]!.photos, [first], "only the removed photo is gone");
  assert.equal($("marker-form").hidden, true);
  await settle();
  assert.equal(images().length, 1);

  click("marker-edit");
  await settle();
  click($("marker-photo-list").querySelector<HTMLElement>("[data-remove]")!);
  assert.deepEqual([...$("marker-photo-list").children].map((item) => item.contains($("marker-add-photos"))), [true],
    "with no photos only the add tile is left");
  submit("marker-form");
  assert.equal(state.markers[0]!.photos, undefined);
  assert.equal(carousel.hidden, true);

  const revoke = URL.revokeObjectURL, revoked: string[] = [];
  URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
  try {
    controls.dispose();
    // Each photo is let go once its read settles, which a busy machine delays.
    await until(() => revoked.length >= 2);
  } finally {
    URL.revokeObjectURL = revoke;
  }
  assert.equal(revoked.length, 2, "leaving the map with the card open lets go of its photos");
});

test("a flooded place's water level and a danger place's level show on its pin and are picked in the edit form", async (t) => {
  const map = mapRecord("water-level");
  const state = defaultNavigation(map.id);
  state.markers = [{
    id: "sump", point: { x: 500, y: 600 }, label: "Sump", description: "", kind: "flooded", water: 2, created: 0,
  }, {
    id: "fall", point: { x: 200, y: 300 }, label: "Fall", description: "", kind: "unstable", created: 1,
  }];
  const controls = openMap(t, map, state);
  const steps = (field: "water" | "danger") => [...document.querySelectorAll<HTMLElement>(`[data-level=${field}]`)];
  const step = (level: number) => steps("water")[level - 1]!;
  const pressed = () => [1, 2, 3].filter((level) => step(level).getAttribute("aria-pressed") === "true");
  const kind = (value: string) => click(document.querySelector<HTMLInputElement>(`input[name="marker-kind"][value="${value}"]`)!);
  // "Water level: Knee (2/3)": the level's own step, then which of how many steps it is.
  const level = () => {
    const line = $("marker-detail-level");
    const scale = [...line.querySelectorAll("[data-scale] > span")];
    const at = scale.findIndex((part) => part.hasAttribute("aria-current"));
    return `${line.firstElementChild!.textContent}: ${scale[at]!.textContent} (${at + 1}/${scale.length})`;
  };
  const openSaved = () => gone("sheet-saved") && click("open-saved");
  openSaved();
  assert.ok($("marker-list").querySelector(".water-gauge"), "Saved shows the level beside the pin");
  controls.options().onMarker(state.markers[0]!);
  assert.equal($("marker-details").hidden, false, "the level alone is worth reading");
  assert.equal(level(), "Water level: Knee (2/3)");
  assert.ok($("marker-dialog-title-icon").querySelector(".water-gauge"));

  click("marker-edit");
  assert.equal($("marker-water").hidden, false);
  assert.deepEqual(pressed(), [2]);
  click(step(2));
  assert.deepEqual(pressed(), [], "tapping the chosen step clears it");
  click(step(3));
  submit("marker-form");
  assert.equal(state.markers[0]!.water, 3);

  click("marker-edit");
  kind("entrance");
  assert.equal($("marker-water").hidden, true, "only flooded places have a level");
  submit("marker-form");
  assert.equal(state.markers[0]!.water, undefined, "a place that is no longer flooded drops its level");
  assert.equal($("marker-detail-level").hidden, true);
  openSaved();
  assert.equal($("marker-list").querySelector(".water-gauge"), null);

  const danger = (level: number) => steps("danger")[level - 1]!;
  const pinFill = () => $("marker-dialog-title-icon").querySelector(".place-icon > .place-pin")!.getAttribute("fill");
  controls.options().onMarker(state.markers[1]!);
  assert.equal(level(), "Danger level: Severe (2/2)", "danger without a level is severe");
  assert.equal(pinFill(), "#ff4d4d");
  click("marker-edit");
  assert.equal($("marker-danger").hidden, false);
  assert.equal($("marker-water").hidden, true);
  assert.equal(danger(2).getAttribute("aria-pressed"), "true");
  click(danger(1));
  click(danger(1));
  assert.equal(danger(1).getAttribute("aria-pressed"), "true", "tapping the chosen danger step keeps it");
  submit("marker-form");
  assert.equal(state.markers[1]!.danger, 1);
  assert.equal(level(), "Danger level: Moderate (1/2)");
  assert.equal(pinFill(), "#ff8a1f", "moderate danger is orange");

  click("marker-edit");
  kind("room");
  assert.equal($("marker-danger").hidden, true, "only danger places have a danger level");
  submit("marker-form");
  assert.equal(state.markers[1]!.danger, undefined, "a place that is no longer dangerous drops its level");
  assert.equal($("marker-detail-level").hidden, true);
});

test("a place keeps one history: visits and notes from its card, edits and moves as they are saved", async (t) => {
  const map = mapRecord("place-log");
  const day = 86_400_000;
  const state = defaultNavigation(map.id);
  state.markers = [{
    id: "hall", point: { x: 500, y: 600 }, label: "Hall", description: "Big pillar room",
    kind: "landmark", created: Date.now() - 400 * day,
  }];
  const controls = openMap(t, map, state);
  // A note as its text, a visit or the place's addition as its kind,
  // and an edit as a line per change, its field first: "Name Hall → Great hall".
  const entries = (list = "marker-log-list") => [...$(list).children].map((item) => {
    const changes = [...item.querySelectorAll("[data-log=changes] li")];
    return changes.length ? changes.map((line) => [...line.childNodes]
      .map((node) => node.nodeName.toLowerCase() === "svg" ? "→" : node.textContent!.trim()).filter(Boolean).join(" ")).join("\n")
      : (item.querySelector("[data-log=text]") ?? item.querySelector("[data-log=head] strong"))!.textContent;
  });
  const daysAgo = (days: number) => {
    const date = new Date(Date.now() - days * day);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const addEntry = (date: string, note: string) => {
    let focused = false;
    $("entry-text").focus = () => { focused = true; };
    click("marker-add-entry");
    assert.ok(focused, "the keyboard opens for a note");
    if (date) type("entry-date", date);
    type("entry-text", note);
    submit("entry-form");
  };
  const place = () => state.markers[0]!;
  controls.options().onMarker(place());
  assert.equal(text("marker-detail-updated"), "Updated 13 months ago", "a place starts as updated when it was added");
  assert.equal(gone("marker-detail-log"), true, "with no history there is no list");

  addEntry("", "");
  assert.deepEqual(place().log!.map(({ text, changes }) => [text, changes]), [[undefined, undefined]], "Add with no note is a visit");
  assert.equal(text("toast"), "Visit added to Hall");
  assert.equal(text("marker-detail-updated"), "Updated today");
  addEntry(daysAgo(30), "Water to the knees");
  assert.equal(text("toast"), "Note added to Hall");
  assert.equal(text("marker-detail-updated"), "Updated today", "a backdated note doesn't make the place older");
  assert.deepEqual(entries(), ["Visited", "Water to the knees", "Added"], "newest first, ending where it was added");
  assert.equal($("marker-log-list").querySelector("button"), null, "reading stays read-only");

  // X asks before dropping a typed note.
  click("marker-add-entry");
  type("entry-text", "Half-written");
  click("entry-cancel");
  assert.equal(isOpen("entry-dialog"), true, "X with a note asks first");
  click("entry-cancel");
  assert.equal(isOpen("entry-dialog"), false);
  assert.equal(place().log!.length, 2, "the discarded note isn't added");

  // Saving an edit says what changed; removing an entry is only tidying.
  click("marker-edit");
  assert.equal(gone("marker-add-entry"), true, "editing has no history button");
  assert.deepEqual(entries("marker-log-edit"), ["Visited", "Water to the knees"]);
  const removes = $("marker-log-edit").querySelectorAll<HTMLElement>("[data-log=remove]");
  assert.equal(removes.length, 2);
  click(removes[1]!);
  type("marker-label", "Great hall");
  submit("marker-form");
  assert.equal(place().deletedLog!.length, 1, "the deleted entry is remembered so a merge can't restore it");
  assert.deepEqual(entries(), ["Name Hall → Great hall", "Visited", "Added"]);
  click("marker-edit");
  submit("marker-form");
  assert.equal(place().log!.length, 2, "an unchanged save adds nothing");
  click("marker-edit");
  type("marker-description", "Big pillar room, dry");
  submit("marker-form");
  assert.deepEqual(entries()[0], "Name Hall → Great hall\nDescription edited", "a later edit the same day joins the first");
  // A move is an edit too; one put back is not.
  click("marker-edit");
  click("marker-move");
  controls.options().onTap({ x: 700, y: 600 });
  click("tool-cancel");
  assert.equal(place().log!.length, 2);
  controls.options().onMarker(place());
  click("marker-edit");
  click("marker-move");
  controls.options().onTap({ x: 700, y: 600 });
  click("tool-done");
  controls.options().onMarker(place());
  assert.deepEqual(entries()[0], "Name Hall → Great hall\nDescription edited\nPosition moved");

  // What came from someone else says who, even a place with no history yet.
  state.markers.push({ id: "shaft", point: { x: 900, y: 600 }, label: "Shaft", description: "",
    kind: "shaft", created: Date.now() - day, by: "Léa" });
  controls.options().onMarker(state.markers[1]!);
  assert.equal($("marker-details").hidden, false);
  assert.deepEqual(entries(), ["Added by Léa"]);
  state.markers[1]!.log = [{ id: "seen", date: Date.now(), by: "Sam" }];
  controls.options().onMarker(state.markers[1]!);
  assert.deepEqual(entries(), ["Visited by Sam", "Added by Léa"]);
});

test("a route reads and edits like a place: name, description and photos", async (t) => {
  const map = mapRecord("route-details");
  await saveMap(map);
  const photo = await savePhoto(map.id, new Blob(["gallery"], { type: "image/jpeg" }));
  const state = defaultNavigation(map.id);
  const route: PlannedRoute = {
    id: "gallery", name: "Gallery", points: [{ x: 100, y: 100 }, { x: 400, y: 300 }], created: 0, draft: false,
  };
  state.routes = [route];
  const framed: Point[][] = [], selected: (string | undefined)[] = [], tools: string[] = [];
  const controls = openMap(t, map, state, {
    setTool(tool) { tools.push(tool); },
    fitPoints(points) { framed.push(points); },
    select(id) { selected.push(id); },
  });
  controls.options().onRoute!(route);
  assert.equal($("marker-dialog").dataset.mode, "view", "tapping a route opens readable details first");
  assert.equal(text("marker-dialog-title"), "Gallery");
  assert.equal($("marker-details").hidden, true, "nothing to read yet: just the header");
  assert.deepEqual(framed.at(-1), route.points, "the whole route is framed");
  assert.equal(selected.at(-1), route.id, "and stands out from the others");

  click("marker-edit");
  assert.equal($("marker-dialog").dataset.mode, "edit");
  assert.equal(text("marker-dialog-title"), "Edit route");
  assert.equal($("marker-kinds").hidden, true);
  assert.equal(gone("marker-move"), true);
  assert.equal(gone("route-points"), false);
  assert.equal(value("marker-label"), "Gallery");
  type("marker-label", "North gallery");
  type("marker-description", "  Low ceiling past the pillar  ");
  // A photo picked in the form, as addPhotos would leave it.
  controls.formPhotos = [photo];
  submit("marker-form");
  assert.deepEqual(
    { name: route.name, description: route.description, photos: route.photos },
    { name: "North gallery", description: "Low ceiling past the pillar", photos: [photo] },
  );
  assert.equal($("marker-dialog").dataset.mode, "view", "saving returns to the details");
  assert.equal(text("marker-detail-description"), "Low ceiling past the pillar");
  assert.equal($("marker-detail-photos").querySelectorAll("img").length, 1);
  await controls.flush();
  assert.deepEqual((await loadNavigation(map.id)).routes[0], route, "route details survive saving and reopening the map");
  // Saved shows one line under the name: points, the photo count, then the description.
  if (gone("sheet-saved")) click("open-saved");
  const savedRow = $("route-list").querySelector("[data-row]")!;
  const photos = savedRow.querySelector("[data-detail] [data-photos]")!;
  assert.equal(photos.getAttribute("aria-label"), "1 photo");
  assert.equal(photos.textContent, "1");
  assert.equal(photos.previousSibling?.textContent, "2 points · ");
  assert.equal(photos.parentElement?.textContent, "2 points · 1 · Low ceiling past the pillar");
  controls.options().onRoute!(route);

  click("marker-edit");
  type("marker-label", "Discarded name");
  type("marker-description", "Discarded description");
  click("marker-cancel");
  assert.equal($("marker-dialog").dataset.mode, "edit", "X with changes asks first");
  click("marker-cancel");
  assert.equal($("marker-dialog").dataset.mode, "view");
  assert.equal(text("marker-dialog-title"), "North gallery");
  assert.equal(route.description, "Low ceiling past the pillar", "Cancel keeps the saved details");

  // Edit points keeps what was typed, then draws on the route.
  click("marker-edit");
  type("marker-description", "");
  click("route-points");
  assert.equal(route.description, undefined, "a cleared description is removed");
  assert.equal(isOpen("marker-dialog"), false);
  assert.equal(tools.at(-1), "route");
  click("tool-done");
  assert.equal(tools.at(-1), "browse");

  controls.options().onRoute!(route);
  click("marker-edit");
  click("marker-delete");
  assert.equal(state.routes.length, 1, "the first tap only arms Delete");
  click("marker-delete");
  assert.equal(state.routes.length, 0);
  assert.equal(isOpen("marker-dialog"), false);
  click("toast-undo");
  assert.deepEqual(state.routes, [route], "Undo brings it back");
});

test("Saved orders its lists and filters them by type", async (t) => {
  const map = mapRecord("saved-order");
  const state = defaultNavigation(map.id);
  const place = (label: string, kind: "entrance" | "unstable", created: number) =>
    ({ id: label, point: { x: 1, y: 1 }, label, description: "", kind, created });
  state.markers = [place("Well", "entrance", 1), place("Arch", "unstable", 2), place("Gate", "entrance", 3)];
  state.routes = [{ id: "loop", name: "Loop", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], created: 0, draft: false }];
  t.after(() => localStorage.removeItem("megamaps:place-order"));
  openMap(t, map, state);
  const places = () => [...$("marker-list").querySelectorAll("[data-row] strong")].map((row) => row.textContent);
  const items = () => [...$("saved-section-menu").querySelectorAll("button")];
  const choose = (label: string) => click(items().find((item) => item.textContent!.trim() === label)!);
  const menuOpen = () => !$("saved-section-menu").hidden;
  // The filter's ring lights up while it hides some places.
  const filtering = () => $("places-order").querySelector("svg")!.classList.contains("text-k");
  click("open-saved");
  assert.equal($("places-order").parentElement, $("saved-places-title"), "the icon sits on the section's title line");
  assert.equal($("routes-order").hidden, true, "a single route has nothing to order");
  assert.deepEqual(places(), ["Gate", "Arch", "Well"], "newest first by default");

  click("places-order");
  assert.equal(document.querySelector("#saved-section-menu [aria-checked=true]")?.textContent!.trim(), "Newest");
  choose("A–Z");
  assert.equal(menuOpen(), false, "picking an order closes the menu");
  assert.deepEqual(places(), ["Arch", "Gate", "Well"]);
  assert.equal(localStorage.getItem("megamaps:place-order"), "name", "the order is kept for next time");

  click("places-order");
  assert.deepEqual(items().map((item) => item.textContent!.trim()).slice(5),
    ["All types", "Entrance", "Danger"], "only kinds saved here are offered");
  choose("Entrance");
  assert.equal(menuOpen(), true, "the filter stays open to pick more");
  assert.deepEqual(places(), ["Gate", "Well"]);
  assert.equal(text("saved-places-count"), "2/3");
  assert.ok(filtering());
  choose("Danger");
  assert.deepEqual(places(), ["Arch", "Gate", "Well"]);
  choose("All types");
  assert.equal(text("saved-places-count"), "3");
  assert.equal(filtering(), true, "the open menu keeps its ring lit");
  click("places-order");
  assert.equal(filtering(), false);
});

test("Measure asks for the map's scale once, then measures lines and gives routes a length", async (t) => {
  const map = mapRecord("measure");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  state.routes = [{
    id: "gallery", name: "Gallery", points: [{ x: 0, y: 0 }, { x: 360, y: 480 }], created: 0, draft: false,
  }];
  const tools: string[] = [];
  let tape: Point[] | undefined;
  const controls = openMap(t, map, state, {
    setTool(tool) { tools.push(tool); },
    setMeasure(points) { tape = points && points.map((point) => ({ ...point })); },
  });
  const tap = (x: number, y: number) => controls.options().onTap({ x, y });
  const routeDetail = () => {
    if (gone("sheet-saved")) click("open-saved");
    return document.querySelector('[data-row="gallery"] [data-detail]')!.textContent;
  };
  assert.equal(routeDetail(), "2 points", "without a scale, a route has no length");
  click("open-measure");
  assert.ok(isOpen("scale-ask-dialog"), "a map without a scale asks for one first");
  assert.deepEqual(tools, [], "and does not start measuring");
  click("scale-ask-start");
  assert.ok(!isOpen("scale-ask-dialog"));
  assert.equal(tools.at(-1), "scale");
  assert.equal(text("tool-title"), "Set scale");
  assert.ok($("dock").hidden, "setting the scale takes the pill's place");
  assert.ok($<HTMLButtonElement>("tool-done").disabled, "Next waits for both ends");

  tap(0, 0);
  tap(100, 0);
  tap(200, 0);
  assert.deepEqual(tape, [{ x: 0, y: 0 }, { x: 200, y: 0 }], "a third tap moves the second end");
  click("route-undo");
  assert.deepEqual(tape, [{ x: 0, y: 0 }, { x: 100, y: 0 }], "Undo puts it back");
  tap(200, 0);
  assert.equal(text("tool-done"), "Next");
  click("tool-done");
  assert.ok(isOpen("scale-dialog"), "Next asks how long the line is");
  assert.equal(value("scale-metres"), "", "a first scale starts empty");
  assert.ok($<HTMLButtonElement>("scale-save").disabled);
  type("scale-metres", "50");
  assert.ok(!$<HTMLButtonElement>("scale-save").disabled);
  submit("scale-form");
  assert.equal(state.metresPerPixel, 0.25, "50 m over 200 pixels");
  assert.equal(tools.at(-1), "measure", "measuring starts right after");
  assert.equal(text("toast"), "Scale set");

  assert.ok(gone("tool-total"), "nothing to read before two points");
  assert.ok(gone("tool-done"), "measuring has nothing to save");
  // Measuring's card takes the pill's place.
  assert.equal($("tool-bar").hidden, false);
  assert.equal($("dock").hidden, true);
  tap(0, 0);
  tap(0, 240);
  tap(320, 240);
  assert.equal(text("tool-distance"), "140 m", "the total follows every segment");
  assert.equal(text("tool-time"), "~2 min on foot", "and so does the walk, beside it");
  assert.equal(text("tool-message"), "Tap to add, drag to adjust");
  assert.equal(routeDetail(), "150 m · ~2 min on foot", "routes show their length once the map has a scale");

  // The pencil changes the scale; × there goes back to the same line.
  assert.equal($("tool-rename").getAttribute("aria-label"), "Change scale");
  click("tool-rename");
  assert.equal(tools.at(-1), "scale");
  assert.deepEqual(tape, [], "a new scale starts from its first end");
  click("tool-cancel");
  assert.equal(tools.at(-1), "measure");
  assert.equal(tape?.length, 3, "the line waited");
  assert.equal(text("tool-distance"), "140 m");

  click("tool-cancel");
  assert.equal(tools.at(-1), "browse", "X ends measuring");
  assert.equal($("dock").hidden, false, "and the pill comes back");
  assert.equal(tape, undefined, "and the line goes with it");
  click("open-measure");
  assert.ok(!isOpen("scale-ask-dialog"), "a map with a scale measures straight away");
  assert.equal(tools.at(-1), "measure");
  assert.deepEqual(tape, [], "starting from a clean line");

  await controls.flush();
  assert.equal((await loadNavigation(map.id))?.metresPerPixel, 0.25, "the scale is kept with the map");
});

test("the last mark: back to it from the wheel or the Trail panel, and read, moved or deleted from its dot", async (t) => {
  const map = mapRecord("mark");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  const tools: string[] = [];
  const views: { center: Point; scale: number }[] = [];
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 20, 14, 5).getTime() });
  const controls = openMap(t, map, state, {
    setTool(tool) { tools.push(tool); },
    showView(view) { views.push(view); },
  });
  const hold = () => controls.options().onHold!({ x: 300, y: 300 }, { x: 200, y: 300 })!;
  const upRight = { x: 260, y: 260 };
  // Before a trip, up-right is named but stays dark, and lifting there does nothing.
  let press = hold();
  press.move(upRight);
  assert.equal($("hold-wheel").dataset.choice, undefined);
  assert.equal(text("hold-label"), "No mark yet");
  press.end(upRight);
  assert.deepEqual(views, []);

  // A mark keeps the view it was made in; up-right later brings that view back.
  state.view = { center: { x: 400, y: 450 }, scale: 0.5, rotation: 0.3 };
  hold().end({ x: 200, y: 380 });
  state.view = { center: { x: 900, y: 900 }, scale: 2, rotation: 0.3 };
  press = hold();
  press.move(upRight);
  assert.equal($("hold-wheel").dataset.choice, "back");
  assert.equal(text("hold-label"), "Go to last mark");
  press.end(upRight);
  assert.deepEqual(views, [{ center: { x: 400, y: 450 }, scale: 0.5 }]);
  // The Trail panel does the same, for whoever has not found the gesture.
  click("open-trail");
  assert.equal(gone("trip-back"), false);
  click("trip-back");
  assert.equal($("sheet").hidden, true);
  assert.equal(views.length, 2);

  // Tapping the red dot reads it first; Edit offers Move and Delete.
  t.mock.timers.tick(12 * 60_000);
  controls.options().onTrailMark!();
  assert.equal(isOpen("mark-dialog"), true);
  assert.equal(text("mark-time"), "Marked 12 minutes ago");
  assert.equal($("mark-actions").hidden, true);
  click("mark-edit");
  assert.equal($("mark-actions").hidden, false);
  // Move: the next tap puts it there, with the view it is made in, and Undo puts it back.
  click("mark-move");
  assert.equal(isOpen("mark-dialog"), false);
  assert.equal(tools.at(-1), "trail");
  assert.equal(text("tool-title"), "Move mark");
  controls.options().onTap({ x: 320, y: 340 });
  assert.equal(tools.at(-1), "browse");
  assert.equal(state.trail.length, 1);
  assert.deepEqual({ ...state.trail[0], time: 0 }, { x: 320, y: 340, time: 0, view: { center: { x: 900, y: 900 }, scale: 2 } });
  assert.equal(text("toast"), "Mark moved");
  click("toast-undo");
  assert.deepEqual({ x: state.trail[0]!.x, y: state.trail[0]!.y }, { x: 300, y: 300 });
  // Delete takes two taps, and can be undone.
  controls.options().onTrailMark!();
  click("mark-edit");
  click("mark-delete");
  assert.equal(state.trail.length, 1, "the first tap only arms Delete");
  click("mark-delete");
  assert.equal(state.trail.length, 0);
  assert.equal(isOpen("mark-dialog"), false);
  click("toast-undo");
  assert.equal(state.trail.length, 1);
});

test("the Trail panel starts a trip, ends it with a summary, and keeps it in Past trips", async (t) => {
  const map = mapRecord("trail");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  state.metresPerPixel = 0.5;
  const tools: string[] = [];
  const shown: (Point[] | undefined)[] = [];
  const framed: Point[][] = [];
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 20, 14, 5).getTime() });
  const controls = openMap(t, map, state, {
    setTool(tool) { tools.push(tool); },
    fitPoints(points) { framed.push(points); },
    showTrip(points) { shown.push(points); },
  });
  const tick = (ms: number) => {
    t.mock.timers.tick(ms);
    flushSync();
  };
  const tap = (x: number, y: number) => controls.options().onTap({ x, y });
  const markHere = (x: number, y: number) => controls.options().onHold!({ x, y }, { x: 200, y: 300 })!.end({ x: 200, y: 360 });
  click("open-trail");
  assert.equal(gone("trip-start"), false);
  assert.equal(gone("trip-end"), true, "there is nothing to end before a trip");
  assert.equal(gone("trip-intro"), false, "the first time, it says what a trip is");
  assert.equal(gone("trip-list"), true, "with no trips there is no list to show");
  // Starting asks where you are, and the tap there is the trip's first point.
  click("trip-start");
  assert.equal(tools.at(-1), "trail");
  tap(100, 100);
  assert.equal(tools.at(-1), "browse", "one tap marks it and the map is back");
  assert.equal(text("toast"), "Trip started");
  assert.equal(text("trip-clock"), "< 1 min", "Trail shows how long the trip has run");
  tick(60_000);
  assert.equal(text("trip-clock"), "1 min", "the clock ticks each minute");

  // Under way, points come from the long-press wheel; the panel only reports and ends.
  tick(29 * 60_000);
  markHere(100, 300);
  tick(65 * 60_000);
  assert.equal(text("trip-clock"), "1 h 35");
  click("open-trail");
  assert.equal(gone("trip-start"), true);
  assert.equal(text("trip-started"), "Started 2:05 PM");
  assert.deepEqual([text("trip-walked"), text("trip-time")], ["100 m", "1 h 35"]);
  assert.equal(text("trip-last"), "1 hour ago");
  assert.equal(text("trip-marks-count"), "2");

  // Ending keeps the trip and shows it whole, with how far and how long.
  click("trip-end");
  assert.deepEqual(state.trail, []);
  assert.equal(gone("trip-clock"), true, "the clock goes with the trip");
  assert.equal(state.trips.length, 1);
  assert.equal(isOpen("trip-dialog"), true);
  assert.equal(text("trip-title"), "Trip Oct 20");
  assert.equal(text("trip-times"), "2026 · 2:05 PM – 3:40 PM");
  assert.deepEqual([text("trip-distance"), text("trip-duration"), text("trip-pace")], ["100 m", "1 h 35", "63 m/h"]);
  assert.equal(text("trip-count"), "2", "with no place passed, the card counts marks instead of saying 0");
  assert.deepEqual(shown.at(-1), [{ x: 100, y: 100 }, { x: 100, y: 300 }].map((p, i) => ({ ...p, time: state.trips[0]!.points[i]!.time })));
  assert.equal(framed.length, 1, "the map frames the whole trip");
  click("trip-close");
  assert.equal(shown.at(-1), undefined, "closing takes the trip off the map");

  // Past trips, newest first, open the same summary again.
  click("open-trail");
  click("trip-start");
  tap(500, 500);
  markHere(600, 500);
  click("open-trail");
  click("trip-end");
  click("open-trail");
  // With trips to show, how they work folds away above them.
  assert.equal(gone("trip-intro"), true);
  assert.equal(gone("trip-how-body"), true);
  click("trip-how");
  assert.equal(gone("trip-how-body"), false);
  const rows = [...$("trip-list").querySelectorAll("[data-row]")];
  assert.deepEqual(rows.map((row) => row.querySelector("[data-detail]")?.textContent),
    ["3:40 PM · 50 m · < 1 min", "2:05 PM · 100 m · 1 h 35"]);
  click(rows[1]!.querySelector("button")!);
  assert.equal($("sheet").hidden, true);
  assert.equal(text("trip-duration"), "1 h 35");
  assert.equal(shown.at(-1)?.length, 2);
});

test("a live trip's panel marks from a button, lists its marks, and leaves past trips for after", async (t) => {
  const map = mapRecord("trail-live");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  state.metresPerPixel = 0.5;
  state.markers.push({ id: "z", point: { x: 100, y: 310 }, label: "Salle Z", description: "", kind: "landmark", created: 0 });
  const tools: string[] = [];
  const views: unknown[] = [];
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 20, 14, 5).getTime() });
  const controls = openMap(t, map, state, {
    setTool(tool) { tools.push(tool); },
    showView(view) { views.push(view); },
  });
  const rows = (id: string) => [...$(id).querySelectorAll("[data-mark]")].map((row) => row.textContent!.replace(/\s+/g, " ").trim());
  click("open-trail");
  click("trip-start");
  controls.options().onTap({ x: 100, y: 100 });
  t.mock.timers.tick(10 * 60_000);
  state.view = { center: { x: 7, y: 8 }, scale: 1, rotation: 0 };

  // Mark here is the same tap on the map that started the trip.
  click("open-trail");
  click("trip-mark");
  assert.equal(tools.at(-1), "trail");
  assert.equal($("sheet").hidden, true);
  controls.options().onTap({ x: 100, y: 300 });
  assert.equal(state.trail.length, 2);

  click("open-trail");
  assert.equal(gone("trip-log-live"), true);
  click("trip-marks");
  assert.deepEqual(rows("trip-log-live"), ["2:15 PM Salle Z +100 m", "2:05 PM Mark 1 Start"], "newest first, named by the place beside it");
  assert.equal(gone("trip-list"), true, "past trips wait until no trip is under way");

  // A mark in the list goes back to the view it was made in.
  click($("trip-log-live").querySelector("[data-mark='1']")!);
  assert.equal($("sheet").hidden, true);
  assert.deepEqual(views, [{ center: { x: 7, y: 8 }, scale: 1 }]);
});

test("without a scale, a finished trip's card leaves out what it can't measure", async (t) => {
  const map = mapRecord("trail-no-scale");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  const time = new Date(2026, 9, 20, 14, 5).getTime();
  state.trips.push({ id: "walk", ended: time + 60 * 60_000, points: [{ x: 0, y: 0, time }, { x: 0, y: 100, time: time + 60_000 }] });
  openMap(t, map, state);
  click("open-trail");
  click($("trip-list").querySelector("[data-row] button")!);
  assert.deepEqual(["trip-distance", "trip-pace", "trip-places"].map(gone), [true, true, true]);
  assert.deepEqual([text("trip-duration"), text("trip-count")], ["1 h 00", "2"]);
});

test("a finished trip can be renamed, read mark by mark, and saved as a route once", async (t) => {
  const map = mapRecord("trail-card");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  state.metresPerPixel = 0.5;
  const time = new Date(2026, 9, 20, 14, 5).getTime();
  state.trips.push({
    id: "walk", ended: time + 60 * 60_000,
    points: [{ x: 0, y: 0, time }, { x: 0, y: 100, time: time + 20 * 60_000 }, { x: 100, y: 100, time: time + 40 * 60_000 }],
  });
  state.markers.push({ id: "lac", point: { x: 0, y: 105 }, label: "Lac", description: "", kind: "landmark", created: 0 });
  const shown: [Point[] | undefined, Point | undefined][] = [];
  const framed: Point[][] = [];
  const jumped: Point[] = [];
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: time + 2 * 3600_000 });
  const controls = openMap(t, map, state, {
    fitPoints(points) { framed.push(points); },
    jumpTo(point) { jumped.push(point); },
    showTrip(points, mark) { shown.push([points, mark]); },
  });
  click("open-trail");
  click($("trip-list").querySelector("[data-row] button")!);
  assert.equal(text("trip-places"), "1");
  assert.equal(gone("trip-count"), true);
  assert.equal(text("trip-passed"), "Lac");

  // Folding open lists every mark, and the map refits above the taller card.
  assert.equal(gone("trip-log"), true);
  const fits = framed.length;
  click("trip-log-toggle");
  assert.deepEqual([...$("trip-log").querySelectorAll("[data-mark]")].map((row) => row.textContent!.replace(/\s+/g, " ").trim()),
    ["2:05 PM Mark 1 Start", "2:25 PM Lac +50 m", "2:45 PM End +50 m"]);
  assert.equal(framed.length, fits + 1);
  click($("trip-log").querySelector("[data-mark='1']")!);
  assert.deepEqual(jumped, [state.trips[0]!.points[1]]);
  assert.equal(shown.at(-1)?.[1], state.trips[0]!.points[1], "the map marks it too");
  assert.equal($("trip-log").querySelector("[data-mark='1']")?.getAttribute("aria-pressed"), "true");

  click("trip-edit");
  type("name-input", "Salle Z loop");
  controls.saveName();
  flushSync();
  assert.equal(text("trip-title"), "Salle Z loop");
  assert.equal(text("trip-times"), "Oct 20, 2026 · 2:05 PM – 3:05 PM", "with a name, the day has to be said");
  assert.equal(state.trips[0]!.name, "Salle Z loop");

  click("trip-route");
  assert.deepEqual(state.routes.map(({ name, points }) => ({ name, points })),
    [{ name: "Salle Z loop", points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }] }]);
  assert.equal($("trip-route").getAttribute("aria-label"), "Saved as route");
  click("trip-route");
  assert.equal(state.routes.length, 1, "a trip is saved only once");
  click("toast-undo");
  assert.deepEqual(state.routes, []);
  assert.equal($("trip-route").getAttribute("aria-label"), "Save as route");
});

test("a map reopened in Compass mode asks for the compass again on the first tap", async (t) => {
  // iOS forgot the answer when the app closed; it only asks again from a tap.
  let asked = 0;
  Object.defineProperty(globalThis, "DeviceOrientationEvent", {
    value: { requestPermission: async () => (asked++, "granted") },
    configurable: true,
  });
  t.after(() => delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent);
  const map = mapRecord("compass-reopen");
  const state = defaultNavigation(map.id);
  state.rotationMode = "compass";
  const orientations: (number | undefined)[] = [];
  openMap(t, map, state, { orient(rotation) { orientations.push(rotation); } });
  assert.equal(asked, 0, "asking needs a tap");
  fire("map-canvas", "touchend");
  await settle();
  assert.equal(asked, 1);
  heading(90);
  assert.equal(orientations.at(-1), -Math.PI / 2, "the map follows the phone again");
  fire("map-canvas", "touchend");
  assert.equal(asked, 1, "only the first tap asks");
});

test("dark map, brightness and layers restyle the map without rebuilding its places", async (t) => {
  const map = mapRecord("restyle");
  const state = defaultNavigation(map.id);
  let rebuilds = 0, restyles = 0;
  openMap(t, map, state, {
    updateNavigation() { rebuilds++; },
    restyle() { restyles++; },
  });
  const toggle = (id: string) => pick(id, !$<HTMLInputElement>(id).checked);
  toggle("dark-map");
  toggle("brightness-75");
  toggle("layer-labels");
  assert.equal(restyles, 3);
  assert.equal(rebuilds, 0);
  assert.equal(state.inverted, !defaultNavigation(map.id).inverted);
  assert.equal(state.dimming, 0.75);
  assert.equal(state.layers.labels, false);
});

test("calibrating matches a spot, then a second one or the rulers", async (t) => {
  const searches: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    searches.push(url);
    return new Response(JSON.stringify([{ lat: "48.8534", lon: "2.3488" }]));
  });
  const map = mapRecord("line-up");
  await saveMap(map);
  const state = defaultNavigation(map.id);
  const tools: string[] = [], moved: Point[] = [];
  // What the streets' cross is on, in Mercator; each step puts it where it needs.
  let streets: Point = { x: 0.5, y: 0.34 };
  const crosses = (x: number, y: number, place: Point, on = state) => {
    on.view = { center: { x, y }, scale: 1, rotation: 0 };
    streets = place;
  };
  const viewer = (into: Point[]) => ({
    setTool(tool: string) { tools.push(tool); }, restyle() {},
    streetsCenter: () => streets,
    streetsScale: () => 2 ** 24,
    moveStreets(center: Point) { into.push(center); },
  });
  const controls = openMap(t, map, state, viewer(moved));
  const calibrate = () => { controls.calibrate(); flushSync(); };
  const drag = (id: string, from: number, to: number) => {
    $(id).setPointerCapture = () => {};
    fire(id, "pointerdown", { clientX: from, pointerId: 1 });
    fire(id, "pointermove", { clientX: to, pointerId: 1 });
    fire(id, "pointerup", { clientX: to, pointerId: 1 });
  };

  calibrate();
  assert.equal(tools.at(-1), "match", "no scale or north is asked for first");
  await settle();
  type("place-query", "Rue Saint-Jacques");
  submit("place-search");
  await settle();
  await settle();
  assert.match(searches[0]!, /q=Rue%20Saint-Jacques/);
  assert.equal(moved.length, 1, "the streets go there");

  crosses(100, 100, { x: 0.5, y: 0.34 });
  click("tool-done");
  assert.equal(tools.at(-1), "match", "the first spot asks what's next");
  assert.ok(gone("place-search"));
  assert.ok($("use-rulers"), "the rulers");
  assert.equal(text("tool-done"), "Match spot 2", "or a second spot");

  crosses(120, 100, { x: 0.501, y: 0.34 });
  click("tool-done");
  assert.equal(tools.at(-1), "match", "too close to the first spot");
  assert.equal($("tool-message").textContent, "Pick a spot further from spot 1");

  // East on the streets is down on the map, so the map's north is a quarter turn off.
  crosses(100, 900, { x: 0.501, y: 0.34 });
  click("tool-done");
  assert.equal(tools.at(-1), "check", "the second spot places the map by itself");
  assert.ok(state.geo);
  assert.equal(text("calibrate-rotation-value"), "90°", "and the rulers show what it found");
  assert.equal(state.streets, undefined, "nothing is kept yet");

  click("match-spots");
  assert.equal(tools.at(-1), "match", "going back keeps the first spot");
  assert.equal(state.geo, undefined);
  click("tool-done");
  assert.equal(tools.at(-1), "check");

  click("tool-done");
  assert.equal(state.streets, true, "the streets stay on");
  assert.equal(tools.at(-1), "browse");
  assert.equal(state.northOffset, 90);
  const metres = state.metresPerPixel!;
  assert.ok(metres > 0);

  // Lined up, Calibrate goes straight to the rulers, which turn the map about a fixed spot.
  const placed = () => state.geo!;
  crosses(500, 500, { x: 0.6, y: 0.34 });
  calibrate();
  assert.equal(tools.at(-1), "check");
  const pivot = worldToScreen(placed(), { x: 500, y: 500 }), { scale } = placed();
  click("calibrate-rotation-more");
  assert.equal(text("calibrate-rotation-value"), "90.1°", "+ is the smallest step you can read");
  click("calibrate-rotation-less");
  assert.equal(text("calibrate-rotation-value"), "90°");
  click("calibrate-scale-more");
  const nudged = placed().scale / scale;
  assert.ok(nudged > 1 && nudged < 1.01, "a nudge barely changes the size");
  drag("calibrate-scale", 300, 299);
  const slow = placed().scale / scale / nudged;
  drag("calibrate-scale", 300, 240);
  assert.ok(slow > 1, "the ruler moving left counts up");
  assert.ok(Math.log(placed().scale / scale / nudged / slow) > 60 * Math.log(slow), "a quick drag covers far more than a slow one");
  drag("calibrate-rotation", 300, 260);
  assert.equal(state.northOffset, 90, "nothing is kept yet");
  const held = worldToScreen(placed(), { x: 500, y: 500 });
  assert.ok(Math.hypot(held.x - pivot.x, held.y - pivot.y) < 1e-12, "the spot stays put");
  click("tool-done");
  assert.notEqual(state.northOffset, 90, "the north follows");
  assert.ok(state.metresPerPixel! > metres, "and the scale");

  // The scale set with the Measure tool can always be gone back to.
  state.measuredScale = 0.5;
  calibrate();
  click("calibrate-scale-reset");
  click("tool-done");
  assert.ok(Math.abs(state.metresPerPixel! - 0.5) < 1e-9);
  assert.equal(state.measuredScale, 0.5);

  // One spot moves a lined-up map, keeping its scale and north.
  const before = placed(), northBefore = state.northOffset, metresBefore = state.metresPerPixel;
  calibrate();
  click("match-spots");
  assert.equal(tools.at(-1), "match");
  crosses(500, 500, { x: 0.7, y: 0.34 });
  click("tool-done");
  click("use-rulers");
  assert.equal(tools.at(-1), "check");
  assert.equal(placed().scale, before.scale);
  assert.equal(placed().rotation, before.rotation);
  click("tool-done");
  assert.equal(state.metresPerPixel, metresBefore, "one spot says nothing new about the scale");
  assert.equal(state.northOffset, northBefore);

  // Another map starts where this one went, and the rulers start from how it looks.
  await settle();
  const other = defaultNavigation("other"), started: Point[] = [];
  const next = openMap(t, { ...map, id: "other" }, other, viewer(started));
  next.calibrate();
  for (let waits = 0; waits < 20 && !started.length; waits++) await settle();
  assert.equal(started.length, 1, "the streets start where the last map was");
  assert.equal(searches.length, 1);
  crosses(100, 100, { x: 0.5, y: 0.34 }, other);
  click("tool-done");
  click("use-rulers");
  assert.equal(other.geo?.scale, 2 ** -24, "as big as it shows beside the streets");
  click("tool-cancel");
  assert.equal(other.geo, undefined, "× leaves the map as it was");
});

/** A map one metre per pixel or so, in Paris, and an app whose position the test moves. */
function linkedApp(t: TestContext, state: NavigationState) {
  const geo: Geo = { x: 0.5064, y: 0.3441, scale: 1 / 26_400_000, rotation: 0 };
  state.geo = geo;
  const app = { running: true, relocalising: false, at: { x: 100, y: 100 } };
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async () => {
    const { lon, lat } = toLonLat({ x: geo.x + app.at.x * geo.scale, y: geo.y + app.at.y * geo.scale });
    return new Response(JSON.stringify({ app: "sPDR", running: app.running, hasGraph: true, steps: 1,
      position: { lat, lon, accuracy: 5, heading: 0, confidence: 1, relocalising: app.relocalising } }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = fetchBefore; });
  return app;
}
const nextPoll = () => new Promise((done) => setTimeout(done, 1050));

test("a running position app grows the trip every 10 m, as recorded points, and ending it holds until it stops", async (t) => {
  const state = defaultNavigation("linked");
  const app = linkedApp(t, state);
  const controls = openMap(t, mapRecord("linked"), state);
  controls.toggleLink();
  t.after(() => { if (controls.linkView()) controls.toggleLink(); });
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(state.trail.length, 1, "the first position starts a trip");
  assert.equal(state.trail[0]!.live, true);

  app.at = { x: 104, y: 100 };
  await nextPoll();
  assert.equal(state.trail.length, 1, "4 m isn't enough to add one");
  app.at = { x: 130, y: 100 };
  app.relocalising = true;
  await nextPoll();
  assert.equal(state.trail.length, 1, "nor is a position the app itself doubts");
  app.relocalising = false;
  await nextPoll();
  assert.equal(state.trail.length, 2);
  assert.ok(Math.abs(state.trail[1]!.x - 130) < 0.5);

  controls.endTrip();
  assert.equal(state.trips.length, 1, "a recorded walk is kept like any trip");
  app.at = { x: 300, y: 100 };
  await nextPoll();
  assert.equal(state.trail.length, 0, "ending it doesn't start another under the user's feet");
  app.running = false;
  await nextPoll();
  app.running = true;
  await nextPoll();
  assert.equal(state.trail.length, 1, "the next run starts a new trip");
  controls.toggleLink();
});
