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

test("viewer controls: menu pill, panels, smart dark, layers, highlight, rotation lock, places and routes", async () => {
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
  let rotation = 0;
  const tools: string[] = [],
    framed: Point[][] = [],
    jumps: Point[] = [];
  // A touch lock saved by an older version must not trap the map.
  state.touchLocked = true;
  const shares: ({ kind: "marker" | "route"; id: string } | undefined)[] = [];
  const controls = new ViewerControls(root, map, state, (item) => shares.push(item));
  assert.equal(state.touchLocked, false);
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
    assert.equal(el("rotation-lock").parentElement, dock, "Lock lives in the pill");
    assert.equal(toolBar.hidden, true);
    assert.equal(root.dataset.tool, "browse");

    // Panels open above the pill, which stays visible as tabs.
    assert.deepEqual(
      [...dock.querySelectorAll("button")].map((b) => b.id),
      ["open-saved", "open-display", "open-add", "rotation-lock"],
    );
    click("open-saved");
    assert.equal(sheet.hidden, false);
    assert.equal(el("sheet-saved").hidden, false);
    assert.equal(el("sheet-display").hidden, true);
    assert.equal(el("sheet-title").textContent, "Saved");
    assert.equal(sheet.dataset.panel, "saved", "panel takes its button's color");
    assert.equal(el("open-saved").getAttribute("aria-expanded"), "true");
    assert.equal(dock.hidden, false);
    // Add opens no panel: Place / Route rise above the pill, and Add's
    // own button turns into × in the same spot to close them.
    const addBar = el("add-bar");
    assert.equal(addBar.hidden, true);
    click("open-add");
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
    click("open-display");
    assert.equal(sheet.hidden, true);
    click("open-saved");
    key(root, "Escape");
    assert.equal(sheet.hidden, true);
    assert.equal(controls.escape(), false, "nothing left to back out of");
    click("open-display");
    click("sheet-dismiss");
    assert.equal(sheet.hidden, true);

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
    assert.equal(el("rotation-lock").getAttribute("aria-label"), "Lock rotation");
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
      5,
      "kinds show the map's pins",
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
    assert.equal(el("marker-note-field").hidden, false, "an existing note shows");
    assert.equal(el("marker-delete").hidden, false);
    input("marker-note", "Updated note");
    submit("marker-form");
    assert.equal(state.markers[0]?.note, "Updated note");
    assert.equal(state.markers.length, 1);
    // Saved list renders names as text, never markup.
    assert.match(el("marker-list").textContent!, /<Entrance>/);
    assert.equal(el("saved-places-count").textContent, "1");
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
    assert.match(placeMore().getAttribute("aria-label")!, /Actions for <Entrance>/);
    const originalMore = placeMore();
    originalMore.dispatchEvent(new window.Event("click"));
    assert.equal(placeMore(), originalMore, "opening a menu keeps the tapped row intact");
    assert.equal(popover()?.parentElement, root, "the menu escapes the scroll container's clipping");
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
    document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    assert.equal(popover(), null);
    assert.equal(placeMore(), originalMore, "outside pointerdown must not replace pending click targets");
    placeMore().dispatchEvent(new window.Event("click"));
    const jump = el("marker-list").querySelector<HTMLButtonElement>(".navigation-jump")!;
    jump.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    assert.equal(popover(), null);
    assert.equal(jump.isConnected, true);
    jump.dispatchEvent(new window.Event("click"));
    assert.equal(sheet.hidden, true, "the same tap can still jump to the place");
    assert.deepEqual(jumps.at(-1), state.markers[0]!.point);
    click("open-saved");
    placeMore().dispatchEvent(new window.Event("click"));
    root.querySelector(".sheet-content")!.dispatchEvent(new window.Event("scroll"));
    assert.equal(popover(), null, "scrolling dismisses the menu instead of leaving it at a stale position");
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
    assert.equal(el("tool-message").textContent, "Drag the pin, or tap where it goes");
    assert.equal(el("route-undo").hidden, true);
    assert.equal((el("tool-done") as HTMLButtonElement).disabled, false);
    tap(700, 800);
    assert.deepEqual(state.markers[0]?.point, { x: 700, y: 800 });
    click("open-add");
    assert.deepEqual(state.markers[0]?.point, { x: 500, y: 600 }, "× puts it back");
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
    assert.equal(popover(), deleteMenu, "confirmation keeps the same menu in place");
    assert.equal(el("route-list").firstElementChild, routeRow, "confirmation leaves the scrollable rows intact");
    assert.notEqual(popover(), null, "the menu stays open for the second delete tap");
    key(root, "Escape");
    openMenu();
    assert.ok(rowButton(/^Delete$/), "reopening clears the pending delete label");
    rowButton(/^Delete$/).dispatchEvent(new window.Event("click"));
    assert.equal(state.routes.length, 1, "reopening must require a fresh confirmation");
    rowButton(/Tap again/).dispatchEvent(new window.Event("click"));
    assert.equal(state.routes.length, 0);

    // Layers hide/show and the highlight briefly reveals everything.
    assert.equal(el("layer-places-count").textContent, "1");
    check("layer-places", false);
    assert.equal(state.layers.places, false);
    click("spotlight");
    assert.equal(stage.classList.contains("spotlight"), true);
    assert.equal(el("spotlight").classList.contains("active"), true);

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
