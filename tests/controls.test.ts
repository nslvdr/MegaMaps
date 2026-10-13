import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ViewerControls } from "../src/ui/viewer-controls";
import { viewerMarkup } from "../src/ui/viewer-markup";
import { defaultNavigation, type PlannedRoute } from "../src/viewer/navigation";
import { saveMap } from "../src/storage/database";
import { loadNavigation } from "../src/storage/navigation";
import { savePhoto } from "../src/storage/photos";
import type { Point } from "../src/viewer/camera";
import type { MapRecord } from "../src/types";
import type { MapSearchMatch } from "../src/viewer/map-search";

test("viewer controls: menu pill, panels, smart dark, layers, highlight, rotation, places and routes", async (t) => {
  const { window, document } = parseHTML(
    `<html><body><section id="viewer">${viewerMarkup}</section></body></html>`,
  );
  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: window,
    configurable: true,
  });
  // Linkedom supplies DOM/events but not native modal-dialog behavior.
  for (const dialog of document.querySelectorAll("dialog")) {
    for (const method of ["show", "showModal"])
      Object.defineProperty(dialog, method, {
        value: () => dialog.setAttribute("open", ""),
      });
    Object.defineProperty(dialog, "close", {
      value: () => {
        if (!dialog.hasAttribute("open")) return;
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new window.Event("close"));
      },
    });
  }
  const root = document.querySelector<HTMLElement>("#viewer")!;
  const focus = t.mock.method(window.HTMLElement.prototype, "focus");
  const map: MapRecord = {
    id: "controls",
    name: "cave.png",
    width: 9000,
    height: 9000,
    bytes: 1,
    backend: "indexeddb",
    created: 0,
    status: "ready",
    levels: [],
  };
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
  const controls = new ViewerControls(root, map, state, (item) => shares.push(item));
  assert.equal(state.touchLocked, false);
  assert.equal(state.dimming, 0.85, "older brightness values use the nearest preset");
  controls.attach({
    setTool(tool: string) {
      tools.push(tool);
    },
    updateNavigation() {},
    jumpTo(point: Point, minimumScale?: number) {
      jumps.push(point);
      requestedZooms.push(minimumScale);
    },
    fitPoints(points: Point[]) {
      framed.push(points);
    },
    setSearch(matches, active, selected = 0) {
      highlights = { matches, active, selected };
    },
    refreshLabels() {
      labelRefreshes++;
    },
    orient(rotation) {
      orientations.push(rotation);
    },
    straighten() {
      straightened++;
    },
    previewPlace(place) {
      previews.push(place && { point: place.point, kind: place.kind });
    },
    pulse(id) {
      pulses.push(id);
    },
    reveal(point) {
      reveals.push(point);
      return { x: 40, y: 300 };
    },
    showing() {
      return onScreen;
    },
  });
  const el = (id: string) => document.getElementById(id)!;
  const click = (id: string) => el(id).dispatchEvent(new window.Event("click"));
  const change = (id: string) =>
    el(id).dispatchEvent(new window.Event("change"));
  const submit = (id: string) =>
    el(id).dispatchEvent(new window.Event("submit", { cancelable: true }));
  const input = (id: string, value: string) =>
    ((el(id) as HTMLInputElement).value = value);
  const check = (id: string, value: boolean) => {
    (el(id) as HTMLInputElement).checked = value;
    change(id);
  };
  const key = (target: EventTarget, name: string) => {
    const event = new window.Event("keydown", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "key", { value: name });
    target.dispatchEvent(event);
  };
  const tap = (x: number, y: number) => controls.options().onTap({ x, y });
  const sheet = el("sheet"),
    dock = el("dock"),
    toolBar = el("tool-bar"),
    stage = el("map-stage");
  try {
    // Browsing: just the menu pill, no panel, no zoom/pan/position buttons.
    assert.equal(sheet.hidden, true);
    assert.equal(dock.hidden, false);
    for (const gone of [
      "zoom-in",
      "zoom-out",
      "touch-lock",
      "viewer-title",
      "compass",
      "locate",
      "map-rail",
      "set-position",
      "layer-position",
      "device-orientation",
      "add-checkpoint",
      "layer-checkpoints",
      "saved-checkpoints",
      "open-more",
      "sheet-more",
      "fit",
      "tool-center",
      "placement-center",
    ])
      assert.equal(document.getElementById(gone), null);
    assert.equal(
      el("open-rotation").parentElement,
      el("display-chips"),
      "Rotation lives beside View in the top corner",
    );
    assert.equal(el("open-display").parentElement, el("display-chips"));
    for (const id of ["open-rotation", "open-display"]) {
      assert.equal(el(id).querySelector("span"), null, "corner buttons show icons only");
      assert.ok(el(id).getAttribute("aria-label"), "icon buttons have accessible names");
    }
    assert.equal(toolBar.hidden, true);
    assert.equal(root.dataset.tool, "browse");

    // Search occupies the space between Saved and Add.
    assert.deepEqual(
      [...dock.children].map((element) => element.id),
      ["open-saved", "open-search", "open-add"],
    );
    assert.equal(el("map-search").parentElement, el("open-search"));
    // Empty Saved lists show their status without offering their own button.
    for (const [id, message] of [
      ["marker-list", "No places yet."],
      ["route-list", "No routes yet."],
    ] as const) {
      assert.equal(el(id).querySelector(".empty-list")!.textContent, message);
      assert.equal(el(id).querySelector("button"), null);
    }
    const refreshesBeforeOpening = labelRefreshes;
    focus.mock.resetCalls();
    click("open-saved");
    assert.equal(focus.mock.callCount(), 0, "opening a panel does not preselect its close button");
    assert.ok(labelRefreshes > refreshesBeforeOpening, "opening a panel refreshes labels on an idle map");
    assert.equal(sheet.hidden, false);
    assert.equal(el("sheet-saved").hidden, false);
    assert.equal(el("sheet-display").hidden, true);
    assert.equal(el("sheet-title").textContent, "Saved");
    assert.equal(el("share-saved").hidden, false);
    assert.ok(el("share-saved").parentElement === el("sheet-title").parentElement, "share sits beside the title");
    assert.equal(el("share-saved").getAttribute("aria-label"), "Share map or selected items");
    for (const id of ["route-list", "marker-list"]) {
      const list = el(id);
      assert.equal(list.tagName, "UL");
      assert.equal(list.firstElementChild?.tagName, "LI");
      assert.ok(document.getElementById(list.getAttribute("aria-labelledby")!));
    }
    assert.equal(
      sheet.dataset.panel,
      "saved",
      "panel takes its button's color",
    );
    assert.equal(el("open-saved").getAttribute("aria-expanded"), "true");
    assert.equal(dock.hidden, false);
    // Add opens a panel like Saved, and its button stays + while it is open.
    focus.mock.resetCalls();
    click("open-add");
    assert.equal(focus.mock.callCount(), 0, "opening Add does not preselect Place");
    assert.equal(sheet.hidden, false);
    assert.equal(sheet.dataset.panel, "add");
    assert.equal(el("sheet-title").textContent, "Add");
    assert.equal(el("sheet-add").hidden, false);
    assert.equal(el("sheet-saved").hidden, true);
    assert.equal(el("open-saved").getAttribute("aria-expanded"), "false");
    assert.equal(el("open-add").getAttribute("aria-expanded"), "true");
    assert.equal(el("open-add").classList.contains("active"), false);
    assert.equal(el("open-add").getAttribute("aria-label"), "Add");
    click("open-add");
    assert.equal(sheet.hidden, true, "Add toggles its panel");
    click("open-add");
    controls.escape();
    assert.equal(sheet.hidden, true, "Back closes the panel");
    click("open-add");
    click("open-saved");
    assert.equal(el("sheet-add").hidden, true, "a panel replaces the choice");
    click("close-sheet");
    click("open-display");
    assert.equal(el("sheet-title").textContent, "View");
    assert.equal(el("share-saved").hidden, true, "sharing appears only in Saved");
    assert.equal(el("sheet-dismiss").hidden, false);
    click("open-display");
    assert.equal(sheet.hidden, true);
    click("open-saved");
    controls.escape();
    assert.equal(sheet.hidden, true);
    assert.equal(controls.escape(), false, "nothing left to back out of");
    click("open-display");
    click("sheet-dismiss");
    assert.equal(sheet.hidden, true);

    // Brightness offers five persistent choices, with 85% selected by default.
    assert.equal(state.dimming, 0.85);
    assert.equal((el("brightness-85") as HTMLInputElement).checked, true);
    const brightnessOptions = [100, 85, 75, 65, 55];
    for (const percent of brightnessOptions) {
      check(`brightness-${percent}`, true);
      assert.equal(state.dimming, percent / 100);
      for (const option of brightnessOptions)
        assert.equal((el(`brightness-${option}`) as HTMLInputElement).checked, option === percent);
      await controls.flush();
      assert.equal((await loadNavigation("controls")).dimming, percent / 100);
    }

    // Smart dark mode is on by default and set from View.
    assert.equal(state.inverted, true);
    assert.equal((el("dark-map") as HTMLInputElement).checked, true);
    controls.options().onAppearance?.({
      filter: "",
      black: "#000",
      kind: "already-dark",
    });
    assert.equal(el("dark-status").textContent, "Map is already dark");
    check("dark-map", false);
    assert.equal(state.inverted, false);
    assert.equal(el("dark-status").textContent, "Off: original colors");
    check("dark-map", true);
    assert.equal(state.inverted, true);

    // The corner Rotation button opens a panel of modes, like View.
    assert.equal(el("open-rotation").getAttribute("aria-label"), "Rotation: Locked");
    click("open-rotation");
    assert.equal(sheet.hidden, false);
    assert.equal(el("sheet-title").textContent, "Rotation");
    assert.equal(el("open-rotation").getAttribute("aria-expanded"), "true");
    assert.equal((el("rotation-locked") as HTMLInputElement).checked, true);
    assert.equal(el("north-field").hidden, true, "north only matters to Auto");
    check("rotation-free", true);
    assert.equal(state.rotationMode, "free");
    assert.equal(el("open-rotation").getAttribute("aria-label"), "Rotation: Normal");
    assert.match(el("rotation-help").textContent!, /two fingers/);
    // Reset sits beside Close and turns the map back to 0°.
    assert.equal(el("reset-rotation").hidden, false);
    assert.ok(el("reset-rotation").nextElementSibling === el("close-sheet"));
    click("reset-rotation");
    assert.equal(straightened, 1);

    // Auto asks for the compass, and tapping it again retries a refusal.
    let permission: PermissionState = "denied";
    Object.defineProperty(globalThis, "DeviceOrientationEvent", {
      value: { requestPermission: async () => permission },
      configurable: true,
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const heading = (degrees: number) => {
      const event = new window.Event("deviceorientation");
      Object.assign(event, { webkitCompassHeading: degrees });
      window.dispatchEvent(event);
    };
    check("rotation-compass", true);
    assert.equal(state.rotationMode, "compass");
    assert.equal(el("reset-rotation").hidden, true, "the compass owns the angle in Auto");
    await settle();
    assert.match(el("rotation-help").textContent!, /access is off/);
    heading(90);
    assert.ok(orientations.every((rotation) => rotation === undefined), "a refused compass is not followed");
    permission = "granted";
    click("rotation-compass");
    await settle();
    assert.match(el("rotation-help").textContent!, /Looking for the compass/);
    // Facing east, the map's north turns to the left of the screen.
    heading(90);
    assert.equal(orientations.at(-1), -Math.PI / 2);
    assert.match(el("rotation-help").textContent!, /turns with your phone/);

    // Its north can sit anywhere on the map; the wheel turns it as each degree passes.
    assert.equal(el("north-field").hidden, false);
    const wheel = el("north-offset");
    const row = 32, zero = 179;
    assert.equal(wheel.scrollTop, zero * row, "the wheel opens on 0°");
    assert.equal(wheel.querySelector(".selected")!.textContent, "0°");
    wheel.scrollTop = (zero + 5) * row + 10;
    wheel.dispatchEvent(new window.Event("scroll"));
    assert.equal(state.northOffset, 5);
    assert.equal(wheel.scrollTop, (zero + 5) * row + 10, "a scrolling wheel is left where the finger is");
    assert.equal(wheel.getAttribute("aria-valuenow"), "5");
    assert.ok(Math.abs(orientations.at(-1)! + (95 * Math.PI) / 180) < 1e-9);
    wheel.scrollTop = 0;
    wheel.dispatchEvent(new window.Event("scroll"));
    assert.equal(wheel.querySelector(".selected")!.textContent, "−179°");
    wheel.scrollTop = (zero + 180) * row;
    wheel.dispatchEvent(new window.Event("scroll"));
    assert.equal(state.northOffset, 180);
    await controls.flush();
    const saved = await loadNavigation("controls");
    assert.equal(saved.rotationMode, "compass");
    assert.equal(saved.northOffset, 180);

    // Locked stops following the phone.
    check("rotation-locked", true);
    assert.equal(orientations.at(-1), undefined);
    const followed = orientations.length;
    heading(180);
    assert.equal(orientations.length, followed);
    assert.equal(el("north-field").hidden, true);
    assert.equal(el("reset-rotation").hidden, false);
    click("close-sheet");
    assert.equal(el("reset-rotation").hidden, true, "reset belongs to the Rotation panel");

    // Highlight with nothing saved is unavailable instead of animating.
    assert.equal((el("spotlight") as HTMLButtonElement).disabled, true);
    click("spotlight");
    assert.equal(stage.classList.contains("spotlight"), false);

    // Places: pick Place, tap the map, save the prefilled card.
    click("open-add");
    click("add-marker");
    assert.equal(sheet.hidden, true);
    // The task card takes the pill's place, with the panels' header and X.
    assert.equal(dock.hidden, true);
    assert.equal(toolBar.hidden, false);
    assert.equal(el("tool-title").textContent, "New place");
    assert.equal(el("tool-message").textContent, "Tap the map where it goes");
    assert.equal(el("tool-actions").hidden, true, "a place needs no buttons");
    assert.equal(el("tool-rename").hidden, true, "only routes are renamed here");
    assert.equal(el("tool-cancel").getAttribute("aria-label"), "Cancel");
    assert.equal(el("open-add").getAttribute("aria-label"), "Add", "Add never turns into X");
    assert.equal((el("open-display") as HTMLButtonElement).disabled, true);
    assert.equal((el("map-search") as HTMLInputElement).disabled, true, "search waits until placing is over");
    assert.equal(root.dataset.tool, "marker");
    tap(500, 600);
    assert.equal(el("marker-dialog").hasAttribute("open"), true);
    assert.equal((el("marker-label") as HTMLInputElement).value, "Landmark 1");
    assert.deepEqual(previews.at(-1), { point: { x: 500, y: 600 }, kind: "landmark" }, "the new pin shows where it goes");
    assert.deepEqual(reveals.at(-1), { x: 500, y: 600 }, "the map keeps the spot clear of the card");
    assert.equal(el("marker-dialog").style.getPropertyValue("--spot-y"), "300px", "and the scrim lights it");
    assert.notEqual(
      document.activeElement,
      el("marker-label"),
      "no keyboard just to accept the prefilled name",
    );
    assert.equal(el("marker-move").hidden, true, "a new place has nothing to move yet");
    assert.equal(
      el("marker-dialog").querySelectorAll(".kind-pick .place-icon > circle").length,
      9,
      "kinds show the map's pins",
    );
    assert.deepEqual(
      Array.from(root.querySelectorAll<HTMLInputElement>('input[name="marker-kind"]'), (input) => input.value),
      ["landmark", "entrance", "stairs", "squeeze", "dead-end", "unstable", "flooded", "graffiti", "new-room"],
      "landmarks and bookmarks share one option",
    );
    assert.equal(el("marker-dialog").querySelector(".kind-picker")!.textContent!.trim(), "", "pins carry no captions");
    assert.equal(
      root.querySelector('input[name="marker-kind"][value="dead-end"]')!.getAttribute("aria-label"),
      "Dead end",
      "each pin is still named for screen readers",
    );
    const entrance = root.querySelector<HTMLInputElement>(
      'input[name="marker-kind"][value="entrance"]',
    )!;
    // Linkedom has no radio-group exclusivity; mimic the browser.
    for (const radio of root.querySelectorAll<HTMLInputElement>(
      'input[name="marker-kind"]',
    ))
      radio.checked = radio === entrance;
    entrance.dispatchEvent(new window.Event("change"));
    assert.equal((el("marker-label") as HTMLInputElement).value, "Entrance 1");
    assert.deepEqual(previews.at(-1), { point: { x: 500, y: 600 }, kind: "entrance" });
    assert.equal(el("marker-dialog").style.getPropertyValue("--c"), "#7dff8a", "the card takes the chosen pin's colour");
    assert.equal(
      el("marker-dialog-title-icon").querySelector(".place-icon > circle")!.getAttribute("fill"),
      "#7dff8a",
      "and its title shows the chosen pin",
    );
    input("marker-label", "<Entrance>");
    input("marker-description", "Left opening");
    submit("marker-form");
    assert.equal(state.markers[0]?.label, "<Entrance>");
    assert.equal(state.markers[0]?.kind, "entrance");
    assert.deepEqual(state.markers[0]?.point, { x: 500, y: 600 });
    el("marker-dialog").dispatchEvent(new window.Event("close"));
    assert.equal(previews.at(-1), undefined, "the saved pin replaces the preview");
    assert.equal(toolBar.hidden, true);
    assert.equal(dock.hidden, false);
    assert.equal((el("open-saved") as HTMLButtonElement).disabled, false);
    assert.equal((el("map-search") as HTMLInputElement).disabled, false);
    controls.options().onMarker(state.markers[0]!);
    assert.equal(pulses.at(-1), state.markers[0]!.id, "the place being read pulses");
    assert.deepEqual(jumps.at(-1), state.markers[0]!.point, "opening a place centers it in the map above its details");
    assert.equal(requestedZooms.at(-1), 1, "opening a place requests native detail zoom");
    assert.equal(el("marker-form").hidden, true, "a place opens as information, not an editing form");
    assert.equal(el("marker-dialog-title").textContent, "<Entrance>");
    assert.doesNotMatch(el("marker-details").textContent!, /Entrance/, "the pin shows the type; the details don't spell it out");
    assert.equal(el("marker-detail-description").textContent, "Left opening");
    assert.equal(el("marker-details").hidden, false);
    assert.equal(el("marker-details").querySelector("Entrance"), null, "place information remains literal text");
    assert.equal(el("marker-edit").nextElementSibling, el("marker-cancel"), "Edit sits beside Close");
    click("marker-edit");
    assert.equal(el("marker-form").hidden, false);
    assert.equal(el("marker-details").hidden, true);
    input("marker-description", "Unsaved changes");
    const cancelEdit = new window.Event("cancel", { cancelable: true });
    el("marker-dialog").dispatchEvent(cancelEdit);
    assert.equal(cancelEdit.defaultPrevented, true, "Escape returns to reading rather than closing the pane");
    assert.equal(el("marker-form").hidden, true);
    assert.equal(el("marker-detail-description").textContent, "Left opening", "canceling leaves the original description intact");
    assert.equal(state.markers[0]?.description, "Left opening");
    click("marker-edit");
    assert.equal(entrance.checked, true);
    assert.equal(el("marker-delete").hidden, false);
    input("marker-description", "Updated description");
    (el("marker-form") as HTMLFormElement).requestSubmit = () => submit("marker-form");
    submit("marker-form");
    assert.equal(state.markers[0]?.description, "Updated description");
    assert.equal(state.markers.length, 1);
    assert.equal(el("marker-form").hidden, true, "saving returns to readable information");
    assert.equal(el("marker-detail-description").textContent, "Updated description");
    click("marker-edit");
    input("marker-description", "");
    submit("marker-form");
    assert.equal(el("marker-details").hidden, true, "a place with nothing to read shows only its header");
    click("marker-cancel");
    assert.equal(el("marker-dialog").hasAttribute("open"), false);
    // Saved list renders names as text, never markup.
    assert.match(el("marker-list").textContent!, /<Entrance>/);
    assert.equal(el("saved-places-count").textContent, "1");
    assert.equal(el("marker-list").querySelector(".navigation-row")?.tagName, "LI");
    // Saved is one list: a Routes section then a Places section, no tabs.
    assert.ok(!document.querySelector("#sheet-saved [role=tab]"), "no tabs in Saved");
    assert.equal(
      el("marker-list").querySelector(".row-icon svg circle")?.getAttribute("fill"),
      "#7dff8a",
      "the row shows the entrance pin as drawn on the map",
    );
    // A row's actions stay tucked behind ⋯, in a small floating menu.
    const popover = () => root.querySelector<HTMLElement>(".row-popover");
    const placeMore = () =>
      el("marker-list").querySelector<HTMLButtonElement>(".row-more")!;
    click("open-saved");
    assert.equal(popover(), null);
    assert.match(
      placeMore().getAttribute("aria-label")!,
      /Actions for <Entrance>/,
    );
    const originalMore = placeMore();
    focus.mock.resetCalls();
    originalMore.dispatchEvent(new window.Event("click"));
    assert.equal(focus.mock.callCount(), 0, "opening row actions does not preselect the first action");
    assert.equal(
      placeMore(),
      originalMore,
      "opening a menu keeps the tapped row intact",
    );
    assert.equal(
      popover()?.parentElement,
      root,
      "the menu escapes the scroll container's clipping",
    );
    assert.equal(popover()?.getAttribute("role"), "menu");
    assert.deepEqual(
      [...popover()!.querySelectorAll("button")].map((b) => b.textContent),
      ["Edit", "Move", "Share", "Delete"],
    );
    assert.equal(placeMore().getAttribute("aria-expanded"), "true");
    [...popover()!.querySelectorAll("button")].find((button) => button.textContent === "Share")!
      .dispatchEvent(new window.Event("click"));
    assert.deepEqual(shares.at(-1), { kind: "marker", id: state.markers[0]!.id });
    assert.equal(state.markers.length, 1, "sharing does not modify the selected place");
    placeMore().dispatchEvent(new window.Event("click"));
    // Tapping elsewhere closes it; so does Back, before the panel.
    document.body.dispatchEvent(
      new window.Event("pointerdown", { bubbles: true }),
    );
    assert.equal(popover(), null);
    assert.equal(
      placeMore(),
      originalMore,
      "outside pointerdown must not replace pending click targets",
    );
    placeMore().dispatchEvent(new window.Event("click"));
    const jump = el("marker-list").querySelector<HTMLButtonElement>(".navigation-jump")!;
    jump.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    assert.equal(popover(), null);
    assert.equal(jump.isConnected, true);
    jump.dispatchEvent(new window.Event("click"));
    assert.equal(
      sheet.hidden,
      true,
      "the same tap can still jump to the place",
    );
    assert.deepEqual(jumps.at(-1), state.markers[0]!.point);
    assert.equal(pulses.at(-1), state.markers[0]!.id, "the place pulses once the map arrives");
    assert.equal(requestedZooms.at(-1), 1, "Saved places request the same detail zoom");
    assert.equal(el("marker-dialog").hasAttribute("open"), true, "Saved places open the same detail view");
    assert.equal(el("marker-form").hidden, true);
    click("marker-cancel");
    click("open-saved");
    placeMore().dispatchEvent(new window.Event("click"));
    root
      .querySelector(".sheet-content")!
      .dispatchEvent(new window.Event("scroll"));
    assert.equal(
      popover(),
      null,
      "scrolling dismisses the menu instead of leaving it at a stale position",
    );
    placeMore().dispatchEvent(new window.Event("click"));
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(popover(), null, "rotation/resize dismisses the menu");
    placeMore().dispatchEvent(new window.Event("click"));
    controls.escape();
    assert.equal(popover(), null);
    assert.equal(sheet.hidden, false);
    placeMore().dispatchEvent(new window.Event("click"));
    click("close-sheet");
    click("open-saved");
    assert.equal(popover(), null, "menus close with the panel");

    // Move lifts the pin: tap (or drag) where it goes; × puts it back.
    placeMore().dispatchEvent(new window.Event("click"));
    popover()!.querySelectorAll("button")[1]!.dispatchEvent(new window.Event("click"));
    assert.equal(root.dataset.tool, "move");
    assert.equal(tools.at(-1), "move");
    assert.equal(sheet.hidden, true);
    assert.equal(
      el("tool-message").textContent,
      "Drag the pin, or tap where it goes",
    );
    assert.equal(el("route-undo").hidden, true);
    assert.equal((el("tool-done") as HTMLButtonElement).disabled, false);
    tap(700, 800);
    assert.deepEqual(state.markers[0]?.point, { x: 700, y: 800 });
    click("tool-cancel");
    assert.deepEqual(
      state.markers[0]?.point,
      { x: 500, y: 600 },
      "× puts it back",
    );
    assert.equal(root.dataset.tool, "browse");
    click("open-saved");
    placeMore().dispatchEvent(new window.Event("click"));
    popover()!.querySelectorAll("button")[1]!.dispatchEvent(new window.Event("click"));
    tap(700, 800);
    click("tool-done");
    assert.deepEqual(state.markers[0]?.point, { x: 700, y: 800 });
    assert.match(el("toast").textContent!, /<Entrance> moved/);

    // Routes start drawing immediately; Done needs two points.
    click("add-route");
    assert.equal(tools.at(-1), "route");
    assert.equal(state.routes.length, 1);
    assert.equal(state.routes[0]?.name, "Route 1");
    const done = el("tool-done") as HTMLButtonElement;
    assert.equal(el("tool-actions").hidden, false);
    assert.equal(done.disabled, true);
    assert.equal((el("route-undo") as HTMLButtonElement).disabled, true);
    assert.equal(el("tool-message").textContent, "Tap where the route starts");
    tap(900, 1000);
    assert.equal(el("tool-message").textContent, "1 point · Tap where it goes next", "one point asks for the next");
    tap(1500, 1700);
    assert.equal(done.disabled, false);
    assert.equal(el("tool-message").textContent, "2 points · Tap to add, drag to adjust");
    click("route-undo");
    assert.equal(state.routes[0]?.points.length, 1);
    assert.equal(done.disabled, true);
    tap(1400, 1600);
    assert.equal(el("tool-title").textContent, "Route 1");
    // The pencil renames the route without leaving the drawing.
    assert.equal(el("tool-rename").hidden, false);
    click("tool-rename");
    input("name-input", "Lower loop");
    submit("name-form");
    assert.equal(el("tool-title").textContent, "Lower loop");
    assert.equal(root.dataset.tool, "route");
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
    assert.equal(el("route-list").querySelector(".navigation-row")?.tagName, "LI");

    // Editing a finished route down to one point restores it.
    const editPoints = () => {
      click("open-saved");
      el("route-list")
        .querySelector(".row-more")!
        .dispatchEvent(new window.Event("click"));
      [...popover()!.querySelectorAll("button")]
        .find((b) => b.textContent === "Edit points")!
        .dispatchEvent(new window.Event("click"));
    };
    editPoints();
    assert.deepEqual(framed.at(-1), state.routes[0]!.points, "editing frames the route");
    click("route-undo");
    assert.equal(state.routes[0]?.points.length, 1);
    controls.escape();
    assert.equal(state.routes[0]?.points.length, 2);
    assert.equal(state.routes[0]?.draft, false);

    // × cancels: a single point goes at once, real work asks twice.
    click("open-add");
    click("add-route");
    tap(100, 100);
    click("tool-cancel");
    assert.equal(state.routes.length, 1);
    assert.match(el("toast").textContent!, /discarded/);
    click("open-add");
    click("add-route");
    tap(100, 100);
    tap(200, 200);
    click("tool-cancel");
    assert.equal(state.routes.length, 2, "first × only asks");
    assert.equal(el("tool-cancel").getAttribute("aria-label"), "Discard?");
    assert.equal(el("tool-cancel").classList.contains("armed"), true);
    assert.equal(el("tool-message").textContent, "Tap × again to discard this route");
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
    assert.match(el("toast").textContent!, /unchanged/);

    // Saved route rows open the route's details, like a place's, and frame it.
    el("route-list")
      .querySelector<HTMLButtonElement>(".navigation-jump")!
      .dispatchEvent(new window.Event("click"));
    assert.equal(el("marker-dialog").dataset.mode, "view");
    assert.equal(el("marker-dialog-title").textContent, "Lower loop");
    assert.equal(el("marker-edit").getAttribute("aria-label"), "Edit route");
    assert.deepEqual(framed.at(-1), state.routes[0]!.points);
    click("marker-cancel");
    assert.equal(el("marker-dialog").hasAttribute("open"), false);

    // Edit uses the place form, delete needs two taps; all behind ⋯.
    const openMenu = () => {
      const more = el("route-list").querySelector<HTMLButtonElement>(".row-more")!;
      if (more.getAttribute("aria-expanded") !== "true")
        more.dispatchEvent(new window.Event("click"));
    };
    const rowButton = (label: RegExp) =>
      [...popover()!.querySelectorAll("button")].find((b) =>
        label.test(b.textContent!),
      )!;
    openMenu();
    assert.deepEqual(
      [...popover()!.querySelectorAll("button")].map((b) => b.textContent),
      ["Edit", "Edit points", "Share", "Delete"],
    );
    rowButton(/^Share$/).dispatchEvent(new window.Event("click"));
    assert.deepEqual(shares.at(-1), { kind: "route", id: state.routes[0]!.id });
    click("share-saved");
    assert.equal(shares.at(-1), undefined, "the map-level action opens selection of all annotations");
    click("open-saved");
    openMenu();
    rowButton(/^Edit$/).dispatchEvent(new window.Event("click"));
    assert.equal(el("marker-dialog-title").textContent, "Edit route");
    assert.equal(el("marker-kinds").hidden, true, "a route's look comes from its line");
    input("marker-label", "Exit plan");
    input("marker-description", "Mind the low ceiling");
    submit("marker-form");
    assert.equal(state.routes[0]?.name, "Exit plan");
    assert.equal(state.routes[0]?.description, "Mind the low ceiling");
    assert.equal(el("marker-dialog").hasAttribute("open"), false, "opened from Saved, Save goes back there");
    await controls.flush();
    assert.equal(
      (await loadNavigation("controls")).routes[0]?.name,
      "Exit plan",
    );
    assert.equal(popover(), null, "the menu closes after an action");
    openMenu();
    const deleteMenu = popover();
    const routeRow = el("route-list").firstElementChild;
    rowButton(/^Delete$/).dispatchEvent(new window.Event("click"));
    assert.equal(state.routes.length, 1);
    assert.equal(
      popover(),
      deleteMenu,
      "confirmation keeps the same menu in place",
    );
    assert.equal(
      el("route-list").firstElementChild,
      routeRow,
      "confirmation leaves the scrollable rows intact",
    );
    assert.notEqual(
      popover(),
      null,
      "the menu stays open for the second delete tap",
    );
    controls.escape();
    openMenu();
    assert.ok(
      rowButton(/^Delete$/),
      "reopening clears the pending delete label",
    );
    rowButton(/^Delete$/).dispatchEvent(new window.Event("click"));
    assert.equal(
      state.routes.length,
      1,
      "reopening must require a fresh confirmation",
    );
    rowButton(/Tap again/).dispatchEvent(new window.Event("click"));
    assert.equal(state.routes.length, 0);
    assert.equal(el("toast").textContent, "Exit plan deleted");

    // Layers hide/show and the highlight briefly reveals everything.
    assert.equal(el("layer-places-count").textContent, "1");
    check("layer-places", false);
    assert.equal(state.layers.places, false);
    click("spotlight");
    assert.equal(stage.classList.contains("spotlight"), true);
    assert.equal(el("spotlight").classList.contains("active"), true);

    // Search stays usable while OCR runs, then reveals every matching location.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    el("open-search").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(el("map-search").getAttribute("aria-expanded"), "true");
    assert.equal(dock.hidden, false, "search keeps Saved and Add available");
    assert.equal(sheet.hidden, true, "search lives in the dock rather than a panel");
    assert.equal(el("close-sheet").hidden, true);
    assert.equal(el("open-search").querySelectorAll("input").length, 1);
    assert.equal(el("open-search").querySelectorAll("button").length, 2, "the count, which is also Next, and Close");
    assert.equal(el("search-close").hidden, false);
    assert.equal(el("search-status").closest("[hidden]"), null, "search status stays available to screen readers");
    assert.equal(el("search-count").parentElement, el("map-search").parentElement);
    assert.equal(el("search-count").hidden, true);
    assert.equal(el("sheet-dismiss").hidden, true, "search leaves the canvas available for gestures");
    controls.updateOcr(undefined, "Detecting map text · 10%");
    input("map-search", "north");
    el("map-search").dispatchEvent(new window.Event("input"));
    assert.equal(highlights?.active, false, "no masking before OCR is ready");
    assert.match(el("search-status").textContent!, /10%/);
    const polygon = [
      { x: 100, y: 200 },
      { x: 180, y: 200 },
      { x: 180, y: 220 },
      { x: 100, y: 220 },
    ];
    const index = {
      mapId: map.id,
      version: 1,
      completedAt: 1,
      lines: [
        { text: "North", confidence: 90, words: [{ text: "North", polygon }] },
      ],
    };
    controls.updateOcr(index);
    assert.equal(highlights?.active, false, "OCR arriving during typing preserves the debounce");
    onScreen = false;
    t.mock.timers.tick(200);
    onScreen = true;
    assert.deepEqual(framed.at(-1), polygon, "a result nowhere on screen is brought into view");
    assert.equal(highlights?.active, true);
    assert.equal(highlights?.matches.length, 1);
    el("map-canvas").dispatchEvent(new window.Event("pointerdown"));
    assert.equal(el("map-search").getAttribute("aria-expanded"), "true", "touching the map keeps search open");
    assert.equal((el("map-search") as HTMLInputElement).value, "north");
    assert.equal(highlights?.active, true, "map gestures keep the matches highlighted");
    assert.match(el("search-status").textContent!, /1 match/);
    assert.equal(el("search-count").textContent, "1 match");
    assert.equal(el("search-count").hidden, false);
    assert.equal(el("search-count").getAttribute("aria-label"), "1 result");
    el("map-search").dispatchEvent(new window.Event("click", { bubbles: true }));
    el("search-count").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(el("map-search").getAttribute("aria-expanded"), "true", "clicking inside the search field keeps it open");
    assert.equal(highlights?.active, true);
    el("map-canvas").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(el("map-search").getAttribute("aria-expanded"), "true", "map clicks keep search open");
    assert.equal(dock.hidden, false, "closing search keeps the navbar visible");
    assert.equal(highlights?.active, true, "map clicks preserve search highlights");
    assert.equal((el("map-search") as HTMLInputElement).value, "north");
    click("open-search");
    input("map-search", "north");
    el("search-close").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(el("map-search").getAttribute("aria-expanded"), "false", "Close in the field ends Search without reopening it through event bubbling");
    assert.equal(el("search-close").hidden, true);
    assert.equal(dock.hidden, false);
    assert.equal((el("map-search") as HTMLInputElement).value, "");
    focus.mock.resetCalls();
    click("open-search");
    assert.equal(focus.mock.callCount(), 1, "tapping the search field opens it ready to type");
    assert.equal(el("map-search").getAttribute("aria-expanded"), "true");
    input("map-search", "north");
    el("map-search").dispatchEvent(new window.Event("input"));
    t.mock.timers.tick(200);
    key(el("map-search"), "Enter");
    assert.deepEqual(framed.at(-1), polygon);
    controls.updateOcr(index, "Detecting map text · 20%");
    assert.match(
      el("search-count").textContent!,
      /^1 match$/,
      "progress keeps the selected result",
    );
    const secondPolygon = polygon.map(({ x, y }) => ({ x: x + 500, y }));
    const multiple = {
      ...index,
      lines: [...index.lines, {
        text: "North entrance", confidence: 90,
        words: [{ text: "North", polygon: secondPolygon }],
      }],
    };
    const frameCount = framed.length;
    controls.updateOcr(multiple);
    assert.equal(framed.length, frameCount, "previewing a match leaves the map in place");
    assert.equal(el("search-count").textContent, "2 matches");
    key(el("map-search"), "Enter");
    key(el("map-search"), "Enter");
    assert.deepEqual(framed.at(-1), secondPolygon);
    assert.equal(highlights?.selected, 1, "the overlay emphasizes the navigated result");
    assert.equal(el("search-count").textContent, "2 / 2", "the count shows where you are");
    assert.match(el("search-status").textContent!, /^Match 2 of 2/);
    controls.updateOcr(multiple, "Detecting map text · 30%");
    assert.equal(highlights?.selected, 1, "OCR progress preserves the overlay selection");
    assert.equal(el("search-count").textContent, "2 / 2", "progress keeps the current match");
    key(el("map-search"), "Enter");
    assert.deepEqual(framed.at(-1), polygon, "next wraps to the first match");
    // The count steps on once the keyboard is away.
    click("search-count");
    assert.deepEqual(framed.at(-1), secondPolygon, "the count is a Next button");
    assert.equal(el("search-count").textContent, "2 / 2");
    assert.equal(el("search-count").getAttribute("aria-label"), "Match 2 of 2. Next match");
    assert.equal(el("map-search").getAttribute("aria-expanded"), "true");
    // Tapping a result's label on the map flies there and keeps every match.
    controls.options().onSearchResult?.(0);
    assert.deepEqual(framed.at(-1), polygon);
    assert.equal(highlights?.selected, 0);
    assert.equal(highlights?.matches.length, 2);
    assert.equal(el("search-count").textContent, "1 / 2");
    input("map-search", "unknown");
    el("map-search").dispatchEvent(new window.Event("input"));
    assert.equal(highlights?.matches.length, 2, "typing keeps the previous search until the debounce settles");
    t.mock.timers.tick(199);
    assert.equal(highlights?.matches.length, 2);
    t.mock.timers.tick(1);
    assert.equal(highlights?.matches.length, 0);
    assert.equal(highlights?.active, true);
    assert.match(el("search-status").textContent!, /No matching/);
    assert.equal(el("search-count").textContent, "No matches");
    assert.equal(el("search-count").hidden, false);
    assert.equal((el("search-count") as HTMLButtonElement).disabled, true, "nothing to step to");
    // A double search keeps the results of both searches that meet.
    input("map-search", "north; south");
    el("map-search").dispatchEvent(new window.Event("input"));
    t.mock.timers.tick(200);
    assert.equal(el("search-count").textContent, "No matches");
    const southPolygon = polygon.map(({ x, y }) => ({ x, y: y + 30 }));
    controls.updateOcr({ ...multiple, lines: [...multiple.lines,
      { text: "South", confidence: 90, words: [{ text: "South", polygon: southPolygon }] }] });
    assert.equal(el("search-count").textContent, "1 match");
    assert.deepEqual(highlights?.matches[0]?.midpoint, { x: 140, y: 225 });
    click("search-count");
    assert.deepEqual(framed.at(-1), [...polygon, ...southPolygon, { x: 140, y: 225 }], "both results come into view");
    controls.updateOcr(multiple);
    input("map-search", "");
    el("map-search").dispatchEvent(new window.Event("input"));
    assert.equal(highlights?.active, false);
    assert.equal(el("search-count").hidden, true);
    input("map-search", "north");
    el("map-search").dispatchEvent(new window.Event("input"));
    stage.dispatchEvent(new window.Event("click", { bubbles: true }));
    t.mock.timers.tick(200);
    assert.equal(highlights?.active, true, "map clicks do not cancel a pending query");
    input("map-search", "unknown");
    el("map-search").dispatchEvent(new window.Event("input"));
    click("search-close");
    assert.equal(highlights?.active, false, "closing search restores the map");
    assert.equal(dock.hidden, false);
    t.mock.timers.tick(200);
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
    input("map-search", "egl");
    el("map-search").dispatchEvent(new window.Event("input"));
    t.mock.timers.tick(100);
    input("map-search", "eglise");
    el("map-search").dispatchEvent(new window.Event("input"));
    t.mock.timers.tick(100);
    assert.equal(highlights?.matches.length, 0, "each keystroke restarts the debounce");
    t.mock.timers.tick(100);
    assert.equal(highlights?.matches.length, 30);
    assert.equal(highlights?.active, true, "saved places highlight while OCR is pending and Places is hidden");
    assert.equal(el("search-count").textContent, "30 matches", "the badge counts every matching location");
    assert.equal(el("search-count").getAttribute("aria-label"), "30 results");
    key(el("map-search"), "Enter");
    assert.deepEqual(jumps.at(-1), landmarks[0]!.point);
    key(el("map-search"), "Enter");
    assert.deepEqual(jumps.at(-1), landmarks[1]!.point);
    assert.equal(highlights?.selected, 1);
    controls.updateOcr(undefined, "Detecting map text · 50%");
    assert.equal(highlights?.selected, 1, "progress preserves saved-place selection");
    input("map-search", "north");
    el("map-search").dispatchEvent(new window.Event("input"));
    const enter = new window.Event("keydown", { cancelable: true });
    Object.defineProperty(enter, "key", { value: "Enter" });
    el("map-search").dispatchEvent(enter);
    assert.equal(highlights?.matches.length, 30, "Enter immediately searches the latest query, including notes");
    assert.equal(highlights?.selected, 0);
    input("map-search", "unknown");
    el("map-search").dispatchEvent(new window.Event("input"));
    input("map-search", "");
    el("map-search").dispatchEvent(new window.Event("input"));
    t.mock.timers.tick(200);
    assert.equal(highlights?.active, false, "clear cancels a pending query");
    controls.escape();
    assert.equal(dock.hidden, false, "Back restores the navbar too");
    state.markers = originalMarkers;

    // Long-press drops a place.
    controls.options().onLongPress?.({ x: 2000, y: 2100 });
    assert.equal(el("marker-dialog").hasAttribute("open"), true);
    assert.equal((el("marker-label") as HTMLInputElement).value, "Entrance 1",
      "a new place starts as the kind last added");
    assert.deepEqual(previews.at(-1), { point: { x: 2000, y: 2100 }, kind: "entrance" });
    submit("marker-form");
    assert.deepEqual(state.markers.at(-1)?.point, { x: 2000, y: 2100 });
    assert.equal(state.markers.at(-1)?.kind, "entrance");
    assert.equal(el("toast").textContent, "Entrance 1 saved");
    assert.equal(el("toast-bar").dataset.tone, "done");
    t.mock.timers.tick(2300);
    assert.equal(el("toast").hidden, true, "a short one goes soon");
    // Toasts stay up for as long as they take to read.
    controls.options().onMarker(state.markers.at(-1)!);
    click("marker-edit");
    input("marker-label", "Lower entrance past the flooded quarry hall west");
    submit("marker-form");
    assert.equal(el("toast").textContent, "Lower entrance past the flooded quarry hall west updated");
    t.mock.timers.tick(4200);
    assert.equal(el("toast").hidden, false, "a longer toast stays up longer");
    t.mock.timers.tick(200);
    assert.equal(el("toast").hidden, true);
    t.mock.timers.reset();

    // Editing keeps a place's spot in the list and says when nothing changed.
    const order = () => state.markers.map((marker) => marker.label);
    const before = order();
    assert.ok(before.length > 1);
    controls.options().onMarker(state.markers[0]!);
    click("marker-edit");
    submit("marker-form");
    assert.equal(el("toast").textContent, `${before[0]} unchanged`);
    assert.equal(el("toast-bar").dataset.tone, "quiet", "nothing changed reads as neutral");
    controls.options().onMarker(state.markers[0]!);
    click("marker-edit");
    input("marker-label", "Upper exit");
    submit("marker-form");
    assert.equal(el("toast").textContent, "Upper exit updated");
    assert.deepEqual(order(), ["Upper exit", ...before.slice(1)]);

    // Move on the card keeps the typed edits, then lifts the pin.
    controls.options().onMarker(state.markers[0]!);
    click("marker-edit");
    assert.equal(el("marker-move").hidden, false, "an existing place can move from its card");
    input("marker-label", "Upper exit");
    click("marker-move");
    assert.equal(tools.at(-1), "move");
    assert.equal(el("marker-dialog").hasAttribute("open"), false);
    assert.equal(state.markers[0]?.label, "Upper exit");
    assert.equal(el("tool-title").textContent, "Upper exit");
    click("tool-cancel");
    assert.equal(tools.at(-1), "browse");
    assert.deepEqual(order(), ["Upper exit", ...before.slice(1)]);

    // The card's Delete takes two taps, like the Saved menu's.
    const deleteLabel = () => el("marker-delete").querySelector("span")!.textContent;
    controls.options().onMarker(state.markers[0]!);
    click("marker-edit");
    click("marker-delete");
    assert.equal(state.markers.length, before.length, "one tap only arms Delete");
    assert.equal(deleteLabel(), "Tap again");
    assert.equal(el("marker-delete").classList.contains("armed"), true, "armed Delete fills red");
    controls.options().onMarker(state.markers[0]!);
    click("marker-edit");
    assert.equal(deleteLabel(), "Delete", "reopening the card disarms it");
    click("marker-delete");
    click("marker-delete");
    assert.equal(state.markers.length, before.length - 1);
    assert.equal(el("toast").textContent, "Upper exit deleted");
    // Undo puts it back where it was in the list.
    assert.equal(el("toast-undo").hidden, false, "a delete offers Undo");
    assert.equal(el("toast-bar").dataset.tone, "removed");
    click("toast-undo");
    assert.deepEqual(order(), ["Upper exit", ...before.slice(1)]);
    assert.equal(el("toast").textContent, "Upper exit restored");
    assert.equal(el("toast-undo").hidden, true, "Undo is offered once");
  } finally {
    controls.dispose();
    await controls.flush();
  }
  assert.equal(stage.classList.contains("spotlight"), false);
});

test("place details read long descriptions safely and expand while scrolling", async () => {
  const { window, document } = parseHTML(
    `<html><body><section id="viewer">${viewerMarkup}</section></body></html>`,
  );
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  const root = document.querySelector<HTMLElement>("#viewer")!;
  const card = document.getElementById("marker-dialog")!;
  for (const dialog of document.querySelectorAll("dialog")) {
    Object.defineProperties(dialog, {
      show: { value: () => dialog.setAttribute("open", "") },
      showModal: { value: () => dialog.setAttribute("open", "") },
      close: { value: () => {
        if (!dialog.hasAttribute("open")) return;
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new window.Event("close"));
      } },
    });
  }
  const map: MapRecord = {
    id: "place-reading", name: "cave.png", width: 1000, height: 1000,
    bytes: 1, backend: "indexeddb", created: 0, status: "ready", levels: [],
  };
  const state = defaultNavigation(map.id);
  const note = "<img src=x onerror=alert(1)>\n" + "A detailed observation.\n".repeat(150);
  const marker = {
    id: "reading-place", point: { x: 500, y: 600 }, label: "<Entrance>",
    description: note, kind: "entrance" as const, created: 0,
  };
  state.markers = [marker];
  const original = structuredClone(marker);
  const centered: { point: Point; animated: boolean | undefined }[] = [];
  const covers: (number | undefined)[] = [];
  const controls = new ViewerControls(root, map, state);
  controls.attach({
    setTool() {}, updateNavigation() {}, fitPoints() {},
    jumpTo(point, _minimumScale, animated) { centered.push({ point, animated }); },
    cover(edge) { covers.push(edge); },
  });
  const details = document.getElementById("marker-details")!,
    noteElement = document.getElementById("marker-detail-description")!,
    editor = document.getElementById("marker-form")!;
  let contentHeight = 2000;
  Object.defineProperty(details.querySelector(".place-detail-content")!, "scrollHeight", {
    get: () => contentHeight,
  });
  Object.defineProperty(details, "clientHeight", { value: 200 });
  Object.defineProperty(card, "offsetTop", { value: 420 });
  // Linkedom lacks layout; these are the pane's collapsed/maximum CSS heights.
  Object.defineProperty(globalThis, "getComputedStyle", {
    value: () => ({ minHeight: "400px", maxHeight: "700px" }), configurable: true,
  });
  const scroll = (top: number) => {
    details.scrollTop = top;
    details.dispatchEvent(new window.Event("scroll"));
  };
  try {
    controls.options().onMarker(marker);
    assert.equal(covers.at(-1), 420, "the map stays full size; the pane only covers it");
    assert.equal(editor.hidden, true);
    assert.equal(noteElement.textContent, note, "long notes retain every line");
    assert.equal(noteElement.querySelector("img"), null, "notes cannot inject markup");
    assert.deepEqual(state.markers[0], original, "reading does not modify the place");
    assert.equal(details.dataset.expandable, "true");
    scroll(20);
    assert.equal(root.style.getPropertyValue("--place-pane-scroll"), "20px", "a small scroll only unfolds that distance");
    assert.deepEqual(centered.at(-1), { point: marker.point, animated: false }, "the map follows pane movement without a separate glide");
    scroll(35);
    assert.equal(root.style.getPropertyValue("--place-pane-scroll"), "35px", "growth follows subsequent scroll distance");
    scroll(300);
    const centeredAtMaximum = centered.length;
    scroll(500);
    assert.equal(root.style.getPropertyValue("--place-pane-scroll"), "300px", "the pane stays at its maximum while notes keep scrolling");
    assert.equal(centered.length, centeredAtMaximum, "ordinary note scrolling does not move the map");
    scroll(450);
    assert.equal(root.style.getPropertyValue("--place-pane-scroll"), "300px");
    scroll(240);
    assert.equal(root.style.getPropertyValue("--place-pane-scroll"), "240px", "scrolling back unfolds the pane in reverse");
    scroll(0);
    for (const type of ["wheel", "touchmove"]) {
      const event = new window.Event(type, { cancelable: true });
      details.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, "native input and touch momentum are not intercepted");
    }
    contentHeight = 80;
    marker.description = "";
    controls.options().onMarker(marker);
    assert.equal(details.dataset.expandable, "false", "short notes need no extra scroll distance");
    assert.equal(noteElement.hidden, true, "a place without a description shows none");
    document.getElementById("marker-cancel")!.dispatchEvent(new window.Event("click"));
    assert.equal(card.hasAttribute("open"), false);
    assert.equal(covers.at(-1), undefined, "closing the pane uncovers the map");
    assert.equal(root.style.getPropertyValue("--place-pane-scroll"), "");
  } finally {
    await controls.dispose();
  }
});

test("reading a place leaves the map usable and closes when tapping away", async () => {
  const { window, document } = parseHTML(
    `<html><body><section id="viewer">${viewerMarkup}</section></body></html>`,
  );
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  const root = document.querySelector<HTMLElement>("#viewer")!;
  const card = document.getElementById("marker-dialog")!;
  const opened: boolean[] = [];
  for (const dialog of document.querySelectorAll("dialog")) {
    const open = (modal: boolean) => () => {
      if (dialog === card) opened.push(modal);
      dialog.setAttribute("open", "");
    };
    Object.defineProperties(dialog, {
      show: { value: open(false) },
      showModal: { value: open(true) },
      close: { value: () => {
        if (!dialog.hasAttribute("open")) return;
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new window.Event("close"));
      } },
    });
  }
  const map: MapRecord = {
    id: "place-dismiss", name: "cave.png", width: 1000, height: 1000,
    bytes: 1, backend: "indexeddb", created: 0, status: "ready", levels: [],
  };
  const state = defaultNavigation(map.id);
  const marker = {
    id: "dismiss-place", point: { x: 500, y: 600 }, label: "Entrance",
    description: "", kind: "entrance" as const, created: 0,
  };
  state.markers = [marker];
  const selected: (string | undefined)[] = [];
  const controls = new ViewerControls(root, map, state);
  controls.attach({
    setTool() {}, updateNavigation() {}, fitPoints() {}, jumpTo() {},
    select(id) { selected.push(id); },
  });
  const press = (target: Element) =>
    target.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  try {
    controls.options().onMarker(marker);
    assert.deepEqual(opened, [false], "the map behind stays usable to pan and zoom");
    assert.equal(selected.at(-1), marker.id, "the place being read is highlighted");
    press(document.getElementById("map-canvas")!);
    press(document.getElementById("marker-dialog-title")!);
    assert.equal(card.hasAttribute("open"), true, "pressing the map may start a pan; the card stays");
    controls.options().onEmptyTap!();
    assert.equal(card.hasAttribute("open"), false, "tapping the map closes it");
    assert.equal(selected.at(-1), undefined);
    controls.options().onMarker(marker);
    press(document.getElementById("open-saved")!);
    assert.equal(card.hasAttribute("open"), false, "pressing other controls closes it");
    controls.options().onMarker(marker);
    assert.equal(controls.escape(), true);
    assert.equal(card.hasAttribute("open"), false, "Back closes it");
    controls.options().onMarker(marker);
    document.getElementById("marker-edit")!.dispatchEvent(new window.Event("click"));
    assert.deepEqual(opened.slice(-2), [false, true], "editing is modal");
    assert.equal(selected.at(-1), marker.id, "switching to editing keeps the place");
    controls.options().onEmptyTap!();
    assert.equal(card.hasAttribute("open"), true, "taps behind the editor don't close it");
    document.getElementById("marker-cancel")!.dispatchEvent(new window.Event("click"));
    assert.deepEqual(opened.slice(-1), [false], "cancelling returns to the readable, non-modal details");
    assert.equal(document.getElementById("marker-dialog-title")!.textContent, "Entrance");
  } finally {
    await controls.dispose();
  }
});

test("place photos lead the details as a carousel and are removed from the edit form", async () => {
  const { window, document } = parseHTML(
    `<html><body><section id="viewer">${viewerMarkup}</section></body></html>`,
  );
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  for (const dialog of document.querySelectorAll("dialog")) {
    Object.defineProperties(dialog, {
      show: { value: () => dialog.setAttribute("open", "") },
      showModal: { value: () => dialog.setAttribute("open", "") },
      close: { value: () => {
        if (!dialog.hasAttribute("open")) return;
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new window.Event("close"));
      } },
    });
  }
  const root = document.querySelector<HTMLElement>("#viewer")!;
  const map: MapRecord = {
    id: "place-photos", name: "quarry.png", width: 1000, height: 1000,
    bytes: 1, backend: "indexeddb", created: 0, status: "ready", levels: [],
  };
  const first = await savePhoto(map.id, new Blob(["first"], { type: "image/jpeg" }));
  const second = await savePhoto(map.id, new Blob(["second"], { type: "image/jpeg" }));
  const state = defaultNavigation(map.id);
  state.markers = [{
    id: "pillar", point: { x: 500, y: 600 }, label: "Pillar", description: "Cracked",
    photos: [second, first], kind: "unstable", created: 0,
  }];
  const controls = new ViewerControls(root, map, state);
  controls.attach({ setTool() {}, updateNavigation() {}, fitPoints() {}, jumpTo() {} });
  const el = (id: string) => document.getElementById(id)!;
  const loaded = () => new Promise((resolve) => setTimeout(resolve, 10));
  try {
    controls.options().onMarker(state.markers[0]!);
    const carousel = el("marker-detail-photos");
    assert.equal(carousel.hidden, false);
    assert.equal(carousel.parentElement!.firstElementChild, carousel, "photos come first in the details");
    assert.deepEqual([...carousel.querySelectorAll("img")].map((image) => image.alt), ["Photo 1 of 2", "Photo 2 of 2"]);
    await loaded();
    assert.ok([...carousel.querySelectorAll("img")].every((image) => image.getAttribute("src")?.startsWith("blob:")));

    carousel.querySelectorAll("button")[1]!.dispatchEvent(new window.Event("click"));
    assert.equal(el("photo-viewer").hasAttribute("open"), true, "tapping a photo shows it full screen");
    assert.deepEqual(
      [...el("photo-viewer").querySelectorAll<HTMLImageElement>(".photo-viewer-track img")].map((image) => image.alt),
      ["Photo 1 of 2", "Photo 2 of 2"],
      "the place's other photos are a swipe away",
    );
    el("photo-viewer-close").dispatchEvent(new window.Event("click"));
    assert.equal(el("photo-viewer").hasAttribute("open"), false);
    assert.equal(el("marker-dialog").hasAttribute("open"), true, "closing the photo returns to the place");

    el("marker-edit").dispatchEvent(new window.Event("click"));
    assert.equal(el("marker-photos-field").hidden, false);
    assert.equal(el("marker-photo-list").children.length, 2);
    el("marker-photo-list").querySelector<HTMLElement>(".photo-remove")!.dispatchEvent(new window.Event("click"));
    el("marker-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
    assert.deepEqual(state.markers[0]!.photos, [first], "only the removed photo is gone");
    assert.equal(el("marker-form").hidden, true);
    assert.equal(carousel.querySelectorAll("img").length, 1);

    el("marker-edit").dispatchEvent(new window.Event("click"));
    el("marker-photo-list").querySelector<HTMLElement>(".photo-remove")!.dispatchEvent(new window.Event("click"));
    assert.equal(el("marker-photos-field").hidden, true, "an empty photo field folds away");
    el("marker-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
    assert.equal(state.markers[0]!.photos, undefined);
    assert.equal(carousel.hidden, true);
  } finally {
    await controls.dispose();
  }
});

test("a route reads and edits like a place: name, description and photos", async () => {
  const { window, document } = parseHTML(
    `<html><body><section id="viewer">${viewerMarkup}</section></body></html>`,
  );
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  for (const dialog of document.querySelectorAll("dialog")) {
    Object.defineProperties(dialog, {
      show: { value: () => dialog.setAttribute("open", "") },
      showModal: { value: () => dialog.setAttribute("open", "") },
      close: { value: () => {
        if (!dialog.hasAttribute("open")) return;
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new window.Event("close"));
      } },
    });
  }
  const root = document.querySelector<HTMLElement>("#viewer")!;
  const map: MapRecord = {
    id: "route-details", name: "quarry.png", width: 1000, height: 1000,
    bytes: 1, backend: "indexeddb", created: 0, status: "ready", levels: [],
  };
  await saveMap(map);
  const photo = await savePhoto(map.id, new Blob(["gallery"], { type: "image/jpeg" }));
  const state = defaultNavigation(map.id);
  const route: PlannedRoute = {
    id: "gallery", name: "Gallery", points: [{ x: 100, y: 100 }, { x: 400, y: 300 }],
    created: 0, draft: false,
  };
  state.routes = [route];
  const framed: Point[][] = [], selected: (string | undefined)[] = [], tools: string[] = [];
  const controls = new ViewerControls(root, map, state);
  controls.attach({
    setTool(tool) { tools.push(tool); }, updateNavigation() {}, jumpTo() {},
    fitPoints(points) { framed.push(points); },
    select(id) { selected.push(id); },
  });
  const el = (id: string) => document.getElementById(id)!;
  const click = (id: string) => el(id).dispatchEvent(new window.Event("click"));
  const submit = () => el("marker-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  (el("marker-form") as HTMLFormElement).requestSubmit = submit;
  try {
    controls.options().onRoute!(route);
    assert.equal(el("marker-dialog").dataset.mode, "view", "tapping a route opens readable details first");
    assert.equal(el("marker-dialog-title").textContent, "Gallery");
    assert.equal(el("marker-details").hidden, true, "nothing to read yet: just the header");
    assert.deepEqual(framed.at(-1), route.points, "the whole route is framed");
    assert.equal(selected.at(-1), route.id, "and stands out from the others");

    click("marker-edit");
    assert.equal(el("marker-dialog").dataset.mode, "edit");
    assert.equal(el("marker-dialog-title").textContent, "Edit route");
    assert.equal(el("marker-kinds").hidden, true);
    assert.equal(el("marker-move").hidden, true);
    assert.equal(el("route-points").hidden, false);
    assert.equal((el("marker-label") as HTMLInputElement).value, "Gallery");
    (el("marker-label") as HTMLInputElement).value = "North gallery";
    (el("marker-description") as HTMLTextAreaElement).value = "  Low ceiling past the pillar  ";
    // A photo picked in the form, as addPhotos would leave it.
    (controls as unknown as { formPhotos: string[] }).formPhotos = [photo];
    submit();
    assert.deepEqual(
      { name: route.name, description: route.description, photos: route.photos },
      { name: "North gallery", description: "Low ceiling past the pillar", photos: [photo] },
    );
    assert.equal(el("marker-dialog").dataset.mode, "view", "saving returns to the details");
    assert.equal(el("marker-detail-description").textContent, "Low ceiling past the pillar");
    assert.equal(el("marker-detail-photos").querySelectorAll("img").length, 1);
    await controls.flush();
    assert.deepEqual((await loadNavigation(map.id)).routes[0], route,
      "route details survive saving and reopening the map");
    // Saved shows one line under the name: points, the photo count, then the description.
    const savedRow = el("route-list").querySelector(".navigation-row")!;
    const photos = savedRow.querySelector(".row-detail .row-photos")!;
    assert.equal(photos.getAttribute("aria-label"), "1 photo");
    assert.equal(photos.textContent, "1");
    assert.equal(photos.previousSibling?.textContent, "2 points · ");
    assert.equal(photos.parentElement?.textContent, "2 points · 1 · Low ceiling past the pillar");

    click("marker-edit");
    (el("marker-label") as HTMLInputElement).value = "Discarded name";
    (el("marker-description") as HTMLTextAreaElement).value = "Discarded description";
    click("marker-cancel");
    assert.equal(el("marker-dialog").dataset.mode, "view");
    assert.equal(el("marker-dialog-title").textContent, "North gallery");
    assert.equal(route.description, "Low ceiling past the pillar", "Cancel keeps the saved details");

    // Edit points keeps what was typed, then draws on the route.
    click("marker-edit");
    (el("marker-description") as HTMLTextAreaElement).value = "";
    click("route-points");
    assert.equal(route.description, undefined, "a cleared description is removed");
    assert.equal(el("marker-dialog").hasAttribute("open"), false);
    assert.equal(tools.at(-1), "route");
    click("tool-done");
    assert.equal(tools.at(-1), "browse");

    controls.options().onRoute!(route);
    click("marker-edit");
    click("marker-delete");
    assert.equal(state.routes.length, 1, "the first tap only arms Delete");
    click("marker-delete");
    assert.equal(state.routes.length, 0);
    assert.equal(el("marker-dialog").hasAttribute("open"), false);
    click("toast-undo");
    assert.deepEqual(state.routes, [route], "Undo brings it back");
  } finally {
    await controls.dispose();
  }
});
