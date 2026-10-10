import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ViewerControls } from "../src/ui/viewer-controls";
import { viewerMarkup } from "../src/ui/viewer-markup";
import { defaultNavigation } from "../src/viewer/navigation";
import { saveMap } from "../src/storage/database";
import { loadNavigation } from "../src/storage/navigation";
import type { Point } from "../src/viewer/camera";
import type { MapRecord } from "../src/types";
import type { MapSearchMatch } from "../src/viewer/map-search";

test("viewer controls: menu pill, panels, smart dark, layers, highlight, rotation lock, places and routes", async (t) => {
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
    Object.defineProperty(dialog, "showModal", {
      value: () => dialog.setAttribute("open", ""),
    });
    Object.defineProperty(dialog, "close", {
      value: () => dialog.removeAttribute("open"),
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
  let rotation = 0;
  let labelRefreshes = 0;
  const tools: string[] = [],
    framed: Point[][] = [],
    jumps: Point[] = [];
  let highlights: { matches: MapSearchMatch[]; active: boolean; selected: number } | undefined;
  // A touch lock saved by an older version must not trap the map.
  state.touchLocked = true;
  const shares: ({ kind: "marker" | "route"; id: string } | undefined)[] = [];
  const controls = new ViewerControls(root, map, state, (item) => shares.push(item));
  assert.equal(state.touchLocked, false);
  assert.equal(state.dimming, 0.85, "older brightness values use the nearest preset");
  controls.attach({
    setTool(tool: string) {
      tools.push(tool);
    },
    updateNavigation() {},
    rotateTo(value: number) {
      rotation = value;
    },
    jumpTo(point: Point) {
      jumps.push(point);
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
      "sheet-add",
      "fit",
      "tool-center",
      "placement-center",
    ])
      assert.equal(document.getElementById(gone), null);
    assert.equal(
      el("rotation-lock").parentElement,
      dock,
      "Lock lives in the pill",
    );
    assert.equal(toolBar.hidden, true);
    assert.equal(root.dataset.tool, "browse");

    // Panels open above the pill, which stays visible as tabs.
    assert.deepEqual(
      [...dock.querySelectorAll("button")].map((b) => b.id),
      [
        "open-saved",
        "open-display",
        "open-search",
        "open-add",
        "rotation-lock",
      ],
    );
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
    assert.equal(el("share-saved").parentElement, el("sheet-title").parentElement);
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
    // Add opens no panel: Place / Route rise above the pill, and Add's
    // own button turns into × in the same spot to close them.
    const addBar = el("add-bar");
    assert.equal(addBar.hidden, true);
    focus.mock.resetCalls();
    click("open-add");
    assert.equal(focus.mock.callCount(), 0, "opening Add does not preselect Place");
    assert.equal(sheet.hidden, true);
    assert.equal(el("open-saved").getAttribute("aria-expanded"), "false");
    assert.equal(dock.hidden, false, "the pill never leaves");
    assert.equal(addBar.hidden, false);
    assert.equal(el("open-add").getAttribute("aria-expanded"), "true");
    assert.equal(el("open-add").classList.contains("active"), true);
    assert.equal(el("open-add-label").textContent, "Close");
    assert.equal(document.getElementById("add-close"), null);
    click("open-add");
    assert.equal(addBar.hidden, true);
    assert.equal(el("open-add-label").textContent, "Add");
    click("open-add");
    key(root, "Escape");
    assert.equal(addBar.hidden, true, "Escape backs out of the choice");
    click("open-add");
    click("open-saved");
    assert.equal(addBar.hidden, true, "a panel replaces the choice");
    click("close-sheet");
    click("open-display");
    assert.equal(el("sheet-title").textContent, "View");
    assert.equal(el("share-saved").hidden, true, "sharing appears only in Saved");
    assert.equal(el("sheet-dismiss").hidden, false);
    click("open-display");
    assert.equal(sheet.hidden, true);
    click("open-saved");
    key(root, "Escape");
    assert.equal(sheet.hidden, true);
    assert.equal(controls.escape(), false, "nothing left to back out of");
    click("open-display");
    click("sheet-dismiss");
    assert.equal(sheet.hidden, true);

    // Brightness offers exactly three persistent choices, with 85% selected by default.
    assert.equal(state.dimming, 0.85);
    assert.equal((el("brightness-85") as HTMLInputElement).checked, true);
    for (const percent of [100, 60, 85]) {
      check(`brightness-${percent}`, true);
      assert.equal(state.dimming, percent / 100);
      for (const option of [100, 85, 60])
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

    // Lock in the pill only stops rotation; fine rotation appears once off.
    assert.equal(el("rotation-lock").getAttribute("aria-pressed"), "true");
    assert.equal(el("rotation-controls").hidden, true);
    click("rotation-lock");
    assert.equal(state.rotationLocked, false);
    assert.equal(el("rotation-lock").getAttribute("aria-pressed"), "false");
    assert.equal(
      el("rotation-lock").getAttribute("aria-label"),
      "Lock rotation",
    );
    assert.match(el("toast").textContent!, /Rotation unlocked/);
    assert.equal(el("rotation-controls").hidden, false);
    click("rotate-right");
    assert.ok(Math.abs(rotation - Math.PI / 12) < 1e-9);
    click("rotation-lock");
    assert.equal(state.rotationLocked, true);
    assert.equal(el("rotation-controls").hidden, true);

    // Highlight with nothing saved explains instead of animating.
    click("spotlight");
    assert.equal(stage.classList.contains("spotlight"), false);
    assert.match(el("toast").textContent!, /Nothing saved/);

    // Places: pick Place, tap the map, save the prefilled card.
    click("open-add");
    click("add-marker");
    assert.equal(sheet.hidden, true);
    assert.equal(dock.hidden, false);
    assert.equal(addBar.hidden, true, "the choice gives way to the hint");
    assert.equal(toolBar.hidden, false);
    assert.equal(el("tool-message").textContent, "Tap the map where it goes");
    assert.equal(el("tool-actions").hidden, true, "a place needs no buttons");
    assert.equal(el("open-add-label").textContent, "Cancel");
    assert.equal((el("open-saved") as HTMLButtonElement).disabled, true);
    assert.equal(root.dataset.tool, "marker");
    tap(500, 600);
    assert.equal(el("marker-dialog").hasAttribute("open"), true);
    assert.equal((el("marker-label") as HTMLInputElement).value, "Landmark 1");
    assert.notEqual(
      document.activeElement,
      el("marker-label"),
      "no keyboard just to accept the prefilled name",
    );
    // Notes stay behind "Add note" until asked for.
    assert.equal(el("marker-note-field").hidden, true);
    assert.equal(el("marker-add-note").hidden, false);
    assert.equal(
      el("marker-dialog").querySelectorAll(".kind-pick svg circle").length,
      4,
      "kinds show the map's pins",
    );
    assert.deepEqual(
      Array.from(root.querySelectorAll<HTMLInputElement>('input[name="marker-kind"]'), (input) => input.value),
      ["landmark", "entrance", "junction", "note"],
      "landmarks and bookmarks share one option",
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
    input("marker-label", "<Entrance>");
    click("marker-add-note");
    assert.equal(el("marker-note-field").hidden, false);
    assert.equal(el("marker-add-note").hidden, true);
    input("marker-note", "Left opening");
    submit("marker-form");
    assert.equal(state.markers[0]?.label, "<Entrance>");
    assert.equal(state.markers[0]?.kind, "entrance");
    assert.deepEqual(state.markers[0]?.point, { x: 500, y: 600 });
    assert.equal(toolBar.hidden, true);
    assert.equal(el("open-add-label").textContent, "Add");
    assert.equal((el("open-saved") as HTMLButtonElement).disabled, false);
    controls.options().onMarker(state.markers[0]!);
    assert.equal(entrance.checked, true);
    assert.equal(
      el("marker-note-field").hidden,
      false,
      "an existing note shows",
    );
    assert.equal(el("marker-delete").hidden, false);
    input("marker-note", "Updated note");
    submit("marker-form");
    assert.equal(state.markers[0]?.note, "Updated note");
    assert.equal(state.markers.length, 1);
    // Saved list renders names as text, never markup.
    assert.match(el("marker-list").textContent!, /<Entrance>/);
    assert.equal(el("saved-places-count").textContent, "1");
    assert.equal(el("marker-list").querySelector(".navigation-row")?.tagName, "LI");
    // Saved is one list: a Routes section then a Places section, no tabs.
    assert.equal(document.querySelector("#sheet-saved [role=tab]"), null);
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
    // Tapping elsewhere closes it; so does Escape, before the panel.
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
    key(root, "Escape");
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
    click("open-add");
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
    tap(900, 1000);
    tap(1500, 1700);
    assert.equal(done.disabled, false);
    click("route-undo");
    assert.equal(state.routes[0]?.points.length, 1);
    assert.equal(done.disabled, true);
    tap(1400, 1600);
    assert.match(el("tool-title").textContent!, /Route 1 · 2 points/);
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
    click("route-undo");
    assert.equal(state.routes[0]?.points.length, 1);
    key(root, "Escape");
    assert.equal(state.routes[0]?.points.length, 2);
    assert.equal(state.routes[0]?.draft, false);

    // × cancels: a single point goes at once, real work asks twice.
    click("open-add");
    click("add-route");
    tap(100, 100);
    click("open-add");
    assert.equal(state.routes.length, 1);
    assert.match(el("toast").textContent!, /discarded/);
    click("open-add");
    click("add-route");
    tap(100, 100);
    tap(200, 200);
    click("open-add");
    assert.equal(state.routes.length, 2, "first × only asks");
    assert.equal(el("open-add-label").textContent, "Discard?");
    assert.match(el("toast").textContent!, /Tap × again to discard Route 2/);
    click("open-add");
    assert.equal(state.routes.length, 1);
    assert.equal(tools.at(-1), "browse");
    // Cancelling an edit restores the route as it was.
    editPoints();
    tap(300, 300);
    click("open-add");
    click("open-add");
    assert.equal(state.routes[0]?.points.length, 2);
    assert.equal(state.routes[0]?.draft, false);
    assert.match(el("toast").textContent!, /unchanged/);

    // Saved route rows frame the route.
    el("route-list")
      .querySelector<HTMLButtonElement>(".navigation-jump")!
      .dispatchEvent(new window.Event("click"));
    assert.deepEqual(framed.at(-1), state.routes[0]!.points);

    // Rename via the name dialog, delete needs two taps; all behind ⋯.
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
      ["Edit points", "Rename", "Share", "Delete"],
    );
    rowButton(/^Share$/).dispatchEvent(new window.Event("click"));
    assert.deepEqual(shares.at(-1), { kind: "route", id: state.routes[0]!.id });
    click("share-saved");
    assert.equal(shares.at(-1), undefined, "the map-level action opens selection of all annotations");
    openMenu();
    rowButton(/Rename/).dispatchEvent(new window.Event("click"));
    input("name-input", "Exit plan");
    submit("name-form");
    assert.equal(state.routes[0]?.name, "Exit plan");
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
    key(root, "Escape");
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
    assert.equal(el("sheet-search").hidden, false);
    assert.equal(dock.hidden, true, "search replaces the navbar");
    assert.equal(el("close-sheet").hidden, true);
    assert.equal(el("sheet-search").querySelectorAll("input").length, 1);
    assert.equal(el("sheet-search").querySelectorAll("button").length, 0);
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
    t.mock.timers.tick(200);
    assert.equal(highlights?.active, true);
    assert.equal(highlights?.matches.length, 1);
    el("map-canvas").dispatchEvent(new window.Event("pointerdown"));
    assert.equal(sheet.hidden, false, "touching the map keeps search open");
    assert.equal((el("map-search") as HTMLInputElement).value, "north");
    assert.equal(highlights?.active, true, "map gestures keep the matches highlighted");
    assert.match(el("search-status").textContent!, /1 match/);
    assert.equal(el("search-count").textContent, "1");
    assert.equal(el("search-count").hidden, false);
    assert.equal(el("search-count").getAttribute("aria-label"), "1 result");
    el("map-search").dispatchEvent(new window.Event("click", { bubbles: true }));
    el("search-count").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(sheet.hidden, false, "clicking inside the search field keeps it open");
    assert.equal(highlights?.active, true);
    el("map-canvas").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(sheet.hidden, true, "clicking outside closes search");
    assert.equal(dock.hidden, false, "closing search restores the navbar");
    assert.equal(highlights?.active, false, "closing removes search highlights");
    assert.equal((el("map-search") as HTMLInputElement).value, "");
    focus.mock.resetCalls();
    click("open-search");
    assert.equal(focus.mock.callCount(), 0, "opening Search waits for a click on the input");
    input("map-search", "north");
    el("map-search").dispatchEvent(new window.Event("input"));
    t.mock.timers.tick(200);
    key(el("map-search"), "Enter");
    assert.deepEqual(framed.at(-1), polygon);
    controls.updateOcr(index, "Detecting map text · 20%");
    assert.match(
      el("search-count").textContent!,
      /^1$/,
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
    assert.equal(el("search-count").textContent, "2");
    key(el("map-search"), "Enter");
    key(el("map-search"), "Enter");
    assert.deepEqual(framed.at(-1), secondPolygon);
    assert.equal(highlights?.selected, 1, "the overlay emphasizes the navigated result");
    assert.equal(el("search-count").textContent, "2");
    controls.updateOcr(multiple, "Detecting map text · 30%");
    assert.equal(highlights?.selected, 1, "OCR progress preserves the overlay selection");
    assert.equal(el("search-count").textContent, "2", "progress keeps the current match");
    key(el("map-search"), "Enter");
    assert.deepEqual(framed.at(-1), polygon, "next wraps to the first match");
    const previous = new window.Event("keydown", { cancelable: true });
    Object.defineProperties(previous, { key: { value: "Enter" }, shiftKey: { value: true } });
    el("map-search").dispatchEvent(previous);
    assert.deepEqual(framed.at(-1), secondPolygon, "previous wraps to the last match");
    input("map-search", "unknown");
    el("map-search").dispatchEvent(new window.Event("input"));
    assert.equal(highlights?.matches.length, 2, "typing keeps the previous search until the debounce settles");
    t.mock.timers.tick(199);
    assert.equal(highlights?.matches.length, 2);
    t.mock.timers.tick(1);
    assert.equal(highlights?.matches.length, 0);
    assert.equal(highlights?.active, true);
    assert.match(el("search-status").textContent!, /No matching/);
    assert.equal(el("search-count").textContent, "0");
    assert.equal(el("search-count").hidden, false);
    input("map-search", "");
    el("map-search").dispatchEvent(new window.Event("input"));
    assert.equal(highlights?.active, false);
    assert.equal(el("search-count").hidden, true);
    input("map-search", "north");
    el("map-search").dispatchEvent(new window.Event("input"));
    stage.dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(highlights?.active, false, "closing search restores the map");
    assert.equal(dock.hidden, false);
    t.mock.timers.tick(200);
    assert.equal(highlights?.active, false, "closing cancels the pending search");

    // Saved places work independently of text detection and layer visibility.
    const originalMarkers = [...state.markers];
    const landmarks = Array.from({ length: 30 }, (_, i) => ({
      id: `search-place-${i}`, kind: "landmark" as const,
      label: i ? `Église ${i}` : "<Église>", note: "North entrance",
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
    assert.equal(el("search-count").textContent, "30", "the badge counts every matching location");
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
    key(root, "Escape");
    assert.equal(dock.hidden, false, "Escape restores the navbar too");
    state.markers = originalMarkers;
    t.mock.timers.reset();

    // Long-press drops a place.
    controls.options().onLongPress?.({ x: 2000, y: 2100 });
    assert.equal(el("marker-dialog").hasAttribute("open"), true);
    assert.equal((el("marker-label") as HTMLInputElement).value, "Landmark 2");
    submit("marker-form");
    assert.deepEqual(state.markers.at(-1)?.point, { x: 2000, y: 2100 });
  } finally {
    controls.dispose();
    await controls.flush();
  }
  assert.equal(stage.classList.contains("spotlight"), false);
});
