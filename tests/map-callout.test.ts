import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { NavigationOverlay, glyphs } from "../src/viewer/overlays";
import { defaultNavigation, markerKinds, routeColor } from "../src/viewer/navigation";
import { worldToScreen } from "../src/viewer/camera";
import { CalloutLayout, boundsOverlap } from "../src/viewer/callout-layout";
import { SearchOverlay } from "../src/viewer/search-overlay";

test("saved places and routes have typed callouts that follow their anchors and retain layer/edit controls", () => {
  const { document } = parseHTML('<html><body><svg class="map-overlay"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const svg = document.querySelector<SVGSVGElement>("svg")!;
  const state = defaultNavigation("callouts");
  state.markers = Object.keys(markerKinds).map((kind, index) => ({
    id: kind,
    kind: kind as keyof typeof markerKinds,
    label: `<${kind}>`,
    note: "",
    point: { x: 100 + index * 60, y: 120 },
    created: 0,
  }));
  state.routes = [{
    id: "exit-route", name: "<Exit route>", created: 0, draft: false,
    points: [{ x: 40, y: 180 }, { x: 260, y: 240 }],
  }];
  const overlay = new NavigationOverlay(svg);
  overlay.rebuild(state);
  const viewport = { width: 600, height: 600 };
  const camera = { x: 150, y: 250, scale: 0.5, rotation: Math.PI / 4 };
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
    assert.equal(callout.querySelector(".map-callout-icon path")!.getAttribute("d"), glyphs[marker.kind].d);
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
  assert.ok([...svg.querySelectorAll(".map-callout")].every(callout => callout.hasAttribute("hidden")),
    "offscreen saved items do not leave detached labels in view");
  overlay.dispose();
});

test("search and saved labels share space, including routes starting on a saved place", () => {
  const { document } = parseHTML('<html><body><svg id="saved"></svg><svg id="search"></svg></body></html>');
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  const savedSvg = document.querySelector<SVGSVGElement>("#saved")!;
  const searchSvg = document.querySelector<SVGSVGElement>("#search")!;
  const state = defaultNavigation("shared-callouts");
  state.markers = [{ id: "entrance", kind: "entrance", label: "Entrance", note: "",
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
  const marker = { id: "church", kind: "landmark" as const, label: "Église", note: "", point: { x: 150, y: 200 }, created: 0 };
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
  assert.equal(callouts[0]!.querySelector(".map-callout-icon path")!.getAttribute("d"), glyphs.landmark.d);
  const hole = searchSvg.querySelector("mask circle")!;
  const point = worldToScreen(camera, marker.point);
  assert.equal(Number(hole.getAttribute("cx")), point.x);
  assert.equal(Number(hole.getAttribute("cy")), point.y);
  assert.equal(savedSvg.querySelector(".map-callout")!.hasAttribute("hidden"), true, "matching saved labels are not duplicated");
  saved.setLayers({ places: false, labels: false, routes: false });
  draw();
  assert.ok(callouts.every(label => !label.hasAttribute("hidden")), "search results remain visible independently of saved layers");
  search.set([], false);
  saved.setSearchMarkers([]);
  saved.setLayers({ places: true, labels: true, routes: true });
  draw();
  assert.equal(savedSvg.querySelector(".map-callout")!.hasAttribute("hidden"), false);
  assert.equal(searchSvg.hasAttribute("hidden"), true);
  search.dispose();
  saved.dispose();
});
