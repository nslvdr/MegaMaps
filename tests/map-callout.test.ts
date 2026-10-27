import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { NavigationOverlay } from "../src/viewer/overlays";
import { markerCalloutIcon } from "../src/ui/icons";
import { defaultNavigation, markerKinds, routeColor } from "../src/viewer/navigation";
import { worldToScreen } from "../src/viewer/camera";
import { CalloutLayout, boundsOverlap, type CalloutBounds } from "../src/viewer/callout-layout";
import { SearchOverlay } from "../src/viewer/search-overlay";
import { MapCallout } from "../src/viewer/map-callout";
import type { Point } from "../src/viewer/camera";

test("saved places and routes have typed callouts that follow their anchors and retain layer/edit controls", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const { document } = parseHTML('<html><body><svg class="map-overlay"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const svg = document.querySelector<SVGSVGElement>("svg")!;
  const state = defaultNavigation("callouts");
  state.markers = Object.keys(markerKinds).map((kind, index) => ({
    id: kind,
    kind: kind as keyof typeof markerKinds,
    label: `<${kind}>`,
    description: "",
    point: { x: 100 + index * 70, y: 120 + index * 70 },
    created: 0,
  }));
  state.routes = [{
    id: "exit-route", name: "<Exit route>", created: 0, draft: false,
    points: [{ x: 40, y: 180 }, { x: 260, y: 240 }],
  }];
  const overlay = new NavigationOverlay(svg);
  overlay.rebuild(state);
  const viewport = { width: 600, height: 600 };
  const camera = { x: 150, y: -50, scale: 0.5, rotation: Math.PI / 4 };
  overlay.draw(camera, viewport);
  const callouts = [...svg.querySelectorAll<SVGGElement>(".map-callout")];
  assert.equal(callouts.length, state.markers.length + state.routes.length, "every saved item has a callout");
  const route = svg.querySelector<SVGGElement>('[data-layer="routes"] .map-callout')!;
  assert.equal(route.querySelector("text")!.textContent, "<Exit route>");
  assert.equal(route.style.getPropertyValue("--callout-color"), routeColor(state, "exit-route"));
  const places = [...svg.querySelectorAll<SVGGElement>('[data-layer="places"] .map-callout')];
  for (const [index, callout] of places.entries()) {
    const marker = state.markers[index]!;
    assert.equal(callout.querySelector("text")!.textContent, marker.label);
    const expectedIcon = document.createElement("div");
    expectedIcon.innerHTML = markerCalloutIcon(marker.kind);
    assert.equal(callout.querySelector(".map-callout-icon")!.innerHTML, expectedIcon.firstElementChild!.innerHTML);
    assert.equal(callout.style.getPropertyValue("--callout-color"), markerKinds[marker.kind].color);
    const position = callout.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
    const connector = callout.querySelector("line")!;
    const anchor = worldToScreen(camera, marker.point);
    const endpoint = { x: position[0]! + Number(connector.getAttribute("x2")),
      y: position[1]! + Number(connector.getAttribute("y2")) };
    assert.ok(Math.abs(endpoint.x - anchor.x) <= 12 + 1e-9);
    assert.ok(Math.abs(endpoint.y - anchor.y) <= 12 + 1e-9);
    assert.ok(Math.abs(Math.max(Math.abs(endpoint.x - anchor.x), Math.abs(endpoint.y - anchor.y)) - 12) < 1e-9,
      "the leader reaches the anchor edge from whichever direction has space");
    assert.ok(callout.classList.contains("overlay-label"), "Names controls the complete callout");
  }
  const boxes = callouts.map(callout => {
    assert.equal(callout.hasAttribute("hidden"), false, "this cluster has space for every label");
    const [x, y] = callout.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
    return { left: x!, right: x! + Number(callout.querySelector("rect")!.getAttribute("width")),
      top: y!, bottom: y! + 36 };
  });
  for (const [index, box] of boxes.entries()) {
    for (const other of boxes.slice(index + 1)) assert.equal(boundsOverlap(box, other), false);
    for (const marker of state.markers) {
      const p = worldToScreen(camera, marker.point);
      assert.equal(boundsOverlap(box, { left: p.x - 12, right: p.x + 12,
        top: p.y - 12, bottom: p.y + 12 }), false, "labels never cover another saved point");
    }
  }
  assert.ok(!svg.querySelector("landmark"), "saved names remain literal text");
  for (const [index, marker] of state.markers.entries()) {
    const box = boxes[state.routes.length + index]!;
    assert.equal(overlay.labelAt({ x: box.right - 2, y: box.bottom - 2 })?.markerId, marker.id,
      "a place's label chip opens that place");
  }
  assert.deepEqual(overlay.labelAt({ x: boxes[0]!.left + 2, y: boxes[0]!.top + 2 }),
    { markerId: undefined, routeId: "exit-route" }, "a route's label chip names the route");
  overlay.setSelected("exit-route");
  assert.ok(svg.querySelector(".route.selected"), "the selected route stands out while its details are open");
  overlay.setSelected();
  assert.equal(svg.querySelector(".route.selected"), null, "closing details clears selection");
  overlay.setLayers({ places: false, routes: false, labels: false });
  assert.equal(svg.classList.contains("hide-labels"), true);
  assert.equal(svg.classList.contains("hide-places"), true);
  assert.equal(svg.classList.contains("hide-routes"), true);
  overlay.setEditing("exit-route", "landmark");
  overlay.draw(camera, viewport);
  assert.ok(svg.querySelector(".route.editing"));
  assert.ok(svg.querySelector(".moving .pin-body"), "place anchors remain available while moving");
  assert.equal(svg.querySelectorAll(".map-callout").length, state.markers.length + state.routes.length);
  overlay.draw({ x: -1000, y: -1000, scale: 1 }, viewport);
  now += 1000;
  overlay.draw({ x: -1000, y: -1000, scale: 1 }, viewport);
  assert.ok([...svg.querySelectorAll(".map-callout")].every(callout => callout.hasAttribute("hidden")),
    "offscreen saved items do not leave detached labels in view");
  overlay.dispose();
});

test("zoomed out, saved items show only pins, except the selected one", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const { document } = parseHTML('<html><body><svg class="map-overlay"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const svg = document.querySelector<SVGSVGElement>("svg")!;
  const state = defaultNavigation("zoomed-out");
  state.markers = ["gate", "well"].map((id, index) =>
    ({ id, kind: "landmark" as const, label: id, description: "", point: { x: 100 + index * 300, y: 300 }, created: 0 }));
  const overlay = new NavigationOverlay(svg);
  overlay.rebuild(state);
  const viewport = { width: 600, height: 600 }, camera = { x: 0, y: 0, scale: 1 };
  const shown = (named: boolean) => {
    overlay.draw(camera, viewport, undefined, named);
    now += 1000;
    overlay.draw(camera, viewport, undefined, named);
    return [...svg.querySelectorAll(".map-callout")].filter(callout => !callout.hasAttribute("hidden"))
      .map(callout => callout.querySelector("text")!.textContent);
  };
  assert.deepEqual(shown(true), ["gate", "well"]);
  assert.deepEqual(shown(false), []);
  assert.equal(svg.querySelectorAll('[data-layer="places"] > g:not(.map-callout)').length, 2, "pins stay");
  overlay.setSelected("well");
  assert.deepEqual(shown(false), ["well"]);
  overlay.dispose();
});

test("route outlines and pins follow the camera and drop out while off screen", () => {
  const { document } = parseHTML('<html><body><svg class="map-overlay"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const svg = document.querySelector<SVGSVGElement>("svg")!;
  const state = defaultNavigation("paths");
  state.markers = [{ id: "gate", kind: "entrance", label: "Gate", description: "", point: { x: 50, y: 50 }, created: 0 }];
  state.routes = [{ id: "walk", name: "Walk", created: 0, draft: false,
    points: [{ x: 10, y: 20 }, { x: 110, y: 70 }, { x: 210, y: 20 }] }];
  const overlay = new NavigationOverlay(svg);
  overlay.rebuild(state);
  const viewport = { width: 400, height: 300 };
  const pin = () => svg.querySelector<SVGGElement>('[data-layer="places"] > g:not(.map-callout)')!;
  for (const camera of [{ x: 0, y: 0, scale: 1 }, { x: 30, y: 15, scale: 2 }]) {
    overlay.draw(camera, viewport);
    const screen = state.routes[0]!.points.map(point => worldToScreen(camera, point));
    const line = screen.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
    const dots = screen.map(p => `M${p.x.toFixed(1)},${p.y.toFixed(1)}h0`).join("");
    const paths = [...svg.querySelectorAll(".route > path")].map(path => path.getAttribute("d"));
    assert.deepEqual(paths, [line, line, dots, dots], "route casing, line and points follow the camera");
    const p = worldToScreen(camera, state.markers[0]!.point);
    assert.equal(pin().getAttribute("transform"), `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    assert.equal(pin().style.display, "");
  }
  overlay.draw({ x: -5000, y: -5000, scale: 1 }, viewport);
  assert.equal(pin().style.display, "none", "an off-screen pin is not drawn");
  overlay.draw({ x: 100, y: 100, scale: 1 }, viewport);
  assert.equal(pin().style.display, "", "it returns when panned back");
  assert.equal(pin().getAttribute("transform"), "translate(150.0,150.0)");
  overlay.dispose();
});
test("search and saved labels share space, including routes starting on a saved place", () => {
  const { document } = parseHTML('<html><body><svg id="saved"></svg><svg id="search"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const savedSvg = document.querySelector<SVGSVGElement>("#saved")!;
  const searchSvg = document.querySelector<SVGSVGElement>("#search")!;
  const state = defaultNavigation("shared-callouts");
  state.markers = [{ id: "entrance", kind: "entrance", label: "Entrance", description: "",
    point: { x: 200, y: 190 }, created: 0 }];
  state.routes = [{ id: "route", name: "Exit", draft: false, created: 0,
    points: [{ x: 200, y: 190 }, { x: 350, y: 220 }] }];
  const saved = new NavigationOverlay(savedSvg);
  saved.setEditing("route");
  saved.rebuild(state);
  const search = new SearchOverlay(searchSvg);
  const textBounds = { left: 150, right: 250, top: 240, bottom: 255 };
  search.set([{ text: "Galerie", polygons: [[
    { x: 150, y: 240 }, { x: 250, y: 240 },
    { x: 250, y: 255 }, { x: 150, y: 255 },
  ]] }], true);
  const viewport = { width: 600, height: 600 };
  const camera = { x: 0, y: 0, scale: 1 };
  const panel = { left: 120, right: 480, top: 400, bottom: 600 };
  const layout = new CalloutLayout(viewport, [panel]);
  search.reserve(camera, layout);
  saved.reserve(camera, layout);
  search.draw(camera, viewport, layout);
  saved.draw(camera, viewport, layout);
  const labels = [...document.querySelectorAll<SVGGElement>(".map-callout")];
  assert.equal(labels.length, 3);
  const boxes = labels.map(label => {
    assert.equal(label.hasAttribute("hidden"), false);
    const [x, y] = label.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
    return { left: x!, right: x! + Number(label.querySelector("rect")!.getAttribute("width")),
      top: y!, bottom: y! + 36 };
  });
  for (const [index, box] of boxes.entries()) {
    assert.equal(boundsOverlap(box, textBounds), false);
    assert.equal(boundsOverlap(box, panel), false);
    for (const other of boxes.slice(index + 1)) assert.equal(boundsOverlap(box, other), false);
  }
  saved.dispose();
  search.dispose();
});

test("search shows text and saved-place callouts together and restores saved labels when cleared", () => {
  const { document } = parseHTML('<html><body><svg id="saved"></svg><svg id="search"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const state = defaultNavigation("search-places");
  const marker = { id: "church", kind: "landmark" as const, label: "Église", description: "", point: { x: 150, y: 200 }, created: 0 };
  state.markers = [marker];
  const savedSvg = document.querySelector<SVGSVGElement>("#saved")!;
  const searchSvg = document.querySelector<SVGSVGElement>("#search")!;
  const saved = new NavigationOverlay(savedSvg);
  saved.rebuild(state);
  saved.setSearchMarkers([marker.id]);
  const search = new SearchOverlay(searchSvg);
  search.set([
    { text: marker.label, polygons: [], marker },
    { text: "Église", polygons: [[{ x: 360, y: 220 }, { x: 430, y: 220 }, { x: 430, y: 240 }, { x: 360, y: 240 }]] },
  ], true);
  const camera = { x: 20, y: 30, scale: 0.9, rotation: 0.1 };
  const viewport = { width: 600, height: 600 };
  const draw = () => {
    const layout = new CalloutLayout(viewport);
    search.reserve(camera, layout);
    saved.reserve(camera, layout);
    search.draw(camera, viewport, layout);
    saved.draw(camera, viewport, layout);
  };
  draw();
  const callouts = [...searchSvg.querySelectorAll<SVGGElement>(".map-callout")];
  assert.equal(callouts.length, 2);
  assert.ok(callouts.every(label => !label.hasAttribute("hidden")), "all visible matches get callouts");
  assert.equal(callouts[0]!.style.getPropertyValue("--callout-color"), markerKinds.landmark.color);
  const expectedIcon = document.createElement("div");
  expectedIcon.innerHTML = markerCalloutIcon(marker.kind);
  assert.equal(callouts[0]!.querySelector(".map-callout-icon")!.innerHTML, expectedIcon.firstElementChild!.innerHTML);
  const hole = searchSvg.querySelector("mask circle")!;
  const point = worldToScreen(camera, marker.point);
  assert.equal(Number(hole.getAttribute("cx")), point.x);
  assert.equal(Number(hole.getAttribute("cy")), point.y);
  assert.equal(savedSvg.querySelector(".map-callout")!.hasAttribute("hidden"), true, "matching saved labels are not duplicated");
  // A tap on a result's label answers with that result, and only on the label.
  const labelCenter = (label: SVGGElement) => {
    const [x, y] = label.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
    return { x: x! + Number(label.querySelector("rect")!.getAttribute("width")) / 2, y: y! + 18 };
  };
  assert.deepEqual(callouts.map(label => search.labelAt(labelCenter(label))), [0, 1]);
  assert.equal(search.labelAt({ x: -50, y: -50 }), undefined);
  saved.setLayers({ places: false, labels: false, routes: false });
  draw();
  assert.ok(callouts.every(label => !label.hasAttribute("hidden")), "search results remain visible independently of saved layers");
  search.set([], false);
  saved.setSearchMarkers([]);
  saved.setLayers({ places: true, labels: true, routes: true });
  draw();
  assert.equal(savedSvg.querySelector(".map-callout")!.hasAttribute("hidden"), false);
  assert.equal(searchSvg.hasAttribute("hidden"), true);
  assert.equal(search.labelAt(labelCenter(callouts[0]!)), undefined, "a closed search answers no taps");
  search.dispose();
  saved.dispose();
});

test("a label glides aside while another is in its way, then back to its normal spot", (t) => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const viewport = { width: 400, height: 400 };
  const callout = new MapCallout(markerCalloutIcon("entrance"));
  callout.setText("Gate");
  document.querySelector("svg")!.append(callout.element);
  const draw = (anchor: Point, obstacles = [] as CalloutBounds[]) => callout.draw(anchor, viewport,
    { left: anchor.x - 12, right: anchor.x + 12, top: anchor.y - 12, bottom: anchor.y + 12 },
    new CalloutLayout(viewport, obstacles));
  const position = () => callout.element.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
  draw({ x: 200, y: 200 });
  const [x0, y0] = position();
  now += 16;
  draw({ x: 210, y: 200 });
  assert.deepEqual(position(), [x0! + 10, y0], "panning carries it exactly with its pin");
  // Another label takes the space above the pin, so this one turns below it.
  const above = [{ left: 160, right: 260, top: 130, bottom: 166 }];
  now += 16;
  assert.equal(draw({ x: 210, y: 200 }, above), true, "it asks for frames while gliding");
  assert.deepEqual(position(), [x0! + 10, y0], "it starts from where it was shown");
  now += 60;
  draw({ x: 210, y: 200 }, above);
  const [, middle] = position();
  now += 1000;
  assert.equal(draw({ x: 210, y: 200 }, above), false, "it settles");
  const [, y1] = position();
  assert.ok(y1! > 200, "it ends below the pin");
  assert.ok(middle! > y0! && middle! < y1!, "it passes between the two spots");
  now += 16;
  draw({ x: 210, y: 200 });
  now += 1000;
  draw({ x: 210, y: 200 });
  assert.deepEqual(position(), [x0! + 10, y0], "once the way clears, it returns above the pin");
});

test("labels fade in, fade out following their pin off screen or without a free side, and leave no tap target", (t) => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const viewport = { width: 400, height: 400 };
  const callout = new MapCallout(markerCalloutIcon("entrance"));
  callout.setText("Gate");
  document.querySelector("svg")!.append(callout.element);
  const draw = (anchor: Point, obstacles = [] as CalloutBounds[]) => callout.draw(anchor, viewport,
    { left: anchor.x - 12, right: anchor.x + 12, top: anchor.y - 12, bottom: anchor.y + 12 },
    new CalloutLayout(viewport, obstacles));
  const opacity = () => callout.element.hasAttribute("hidden") ? 0 : Number(callout.element.style.opacity || 1);
  const position = () => callout.element.getAttribute("transform")!.slice(10, -1).split(",").map(Number);
  assert.equal(draw({ x: 200, y: 200 }), true, "it keeps drawing while it fades in");
  const first = opacity();
  assert.ok(first > 0 && first < 1, "it appears faintly");
  now += 1000;
  assert.equal(draw({ x: 200, y: 200 }), false);
  assert.equal(opacity(), 1);
  const [x0, y0] = position();
  // The pin leaves the screen: the label follows it while fading.
  now += 60;
  assert.equal(draw({ x: 200, y: 430 }), true);
  assert.ok(opacity() > 0 && opacity() < 1, "it fades rather than vanishing");
  assert.deepEqual(position(), [x0, y0! + 230], "it stays beside its pin");
  assert.equal(callout.bounds, undefined, "a fading label cannot be tapped");
  now += 1000;
  assert.equal(draw({ x: 200, y: 450 }), false);
  assert.equal(callout.element.hasAttribute("hidden"), true);
  // With every side taken, only the pin shows.
  const crowd = [{ left: 0, right: 400, top: 0, bottom: 185 }, { left: 0, right: 400, top: 215, bottom: 400 }];
  now += 16;
  draw({ x: 200, y: 200 }, crowd);
  assert.equal(callout.element.hasAttribute("hidden"), true, "no label without a free side");
  now += 16;
  draw({ x: 200, y: 200 });
  now += 1000;
  draw({ x: 200, y: 200 });
  now += 60;
  draw({ x: 200, y: 200 }, crowd);
  assert.ok(opacity() > 0 && opacity() < 1, "a label that loses its spot fades out too");
  now += 1000;
  draw({ x: 200, y: 200 }, crowd);
  assert.equal(callout.element.hasAttribute("hidden"), true);
});

test("large labels draw a taller, wider chip for the same text", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const viewport = { width: 400, height: 400 };
  const chip = () => {
    const callout = new MapCallout(markerCalloutIcon("entrance"));
    callout.setText("Gate");
    document.querySelector("svg")!.append(callout.element);
    const anchor = { x: 200, y: 200 };
    callout.draw(anchor, viewport, { left: 188, right: 212, top: 188, bottom: 212 }, new CalloutLayout(viewport, []));
    const { left, right, top, bottom } = callout.bounds!;
    return { width: right - left, height: bottom - top };
  };
  const standard = chip();
  document.documentElement.dataset.labels = "large";
  const large = chip();
  assert.equal(standard.height, 36);
  assert.equal(large.height, 40);
  assert.ok(large.width > standard.width);
});

test("a double search result reveals where its pair meets and the saved places in it", () => {
  const { document } = parseHTML('<html><body><svg></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const svg = document.querySelector<SVGSVGElement>("svg")!;
  const search = new SearchOverlay(svg);
  const pin = { x: 300, y: 120 }, midpoint = { x: 200, y: 110 };
  search.set([{ text: "25; Puits", midpoint, pins: [pin],
    polygons: [[{ x: 60, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 120 }, { x: 60, y: 120 }]] }], true);
  search.draw({ x: 0, y: 0, scale: 1 }, { width: 600, height: 600 });
  const circles = [...svg.querySelectorAll("mask circle")].map(circle =>
    ({ x: Number(circle.getAttribute("cx")), y: Number(circle.getAttribute("cy")) }));
  assert.deepEqual(circles, [midpoint, pin]);
  assert.equal(svg.querySelectorAll("mask polygon").length, 1);
  search.dispose();
});

test("selecting in place keeps every pin and label and lays them out as a rebuild would", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const { document } = parseHTML('<html><body><svg class="map-overlay"></svg><svg class="map-overlay"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const [inPlace, rebuilt] = [...document.querySelectorAll<SVGSVGElement>("svg")];
  const state = defaultNavigation("select");
  // Crowded, so the selected label's priority decides who gets the space.
  state.markers = ["a", "b", "c", "d"].map((id, index) =>
    ({ id, kind: "landmark" as const, label: `Place ${id}`, description: "", point: { x: 200 + index * 14, y: 200 }, created: 0 }));
  state.routes = [{ id: "walk", name: "Walk", created: 0, draft: false, points: [{ x: 190, y: 210 }, { x: 260, y: 230 }] }];
  const viewport = { width: 400, height: 400 }, camera = { x: 0, y: 0, scale: 1 };
  const layout = (svg: SVGSVGElement) => {
    overlay(svg).draw(camera, viewport);
    now += 1000;
    overlay(svg).draw(camera, viewport);
    return [...svg.querySelectorAll(".map-callout")].map(callout =>
      callout.hasAttribute("hidden") ? "hidden" : callout.getAttribute("transform"));
  };
  const overlays = new Map<SVGSVGElement, NavigationOverlay>();
  const overlay = (svg: SVGSVGElement) => overlays.get(svg)!;
  overlays.set(inPlace!, new NavigationOverlay(inPlace!));
  overlays.set(rebuilt!, new NavigationOverlay(rebuilt!));
  overlay(inPlace!).rebuild(state);
  layout(inPlace!);
  const before = [...inPlace!.querySelectorAll("g")];
  for (const id of ["c", "walk", "d", undefined]) {
    overlay(inPlace!).setSelected(id);
    overlay(rebuilt!).setSelected(id);
    overlay(rebuilt!).rebuild(state);
    assert.deepEqual(layout(inPlace!), layout(rebuilt!), `labels sit as after a rebuild with ${id} selected`);
    const marked = (svg: SVGSVGElement) => [...svg.querySelectorAll(".selected")]
      .map(element => [element.getAttribute("class"), element.getAttribute("transform")]);
    assert.deepEqual(marked(inPlace!), marked(rebuilt!));
  }
  assert.deepEqual([...inPlace!.querySelectorAll("g")], before, "no pin or label was rebuilt");
  overlay(inPlace!).dispose();
  overlay(rebuilt!).dispose();
});
