import { icons } from "./icons";
import { markerKinds } from "../viewer/navigation";
import { placeIcon } from "./place-icon";

// Panels are stacked cards of rows: icon, label, then the row's control.
const rowIcon = (icon: string, tint = "") =>
  `<i class="row-icon ${tint}">${icon}</i>`;
const layerRow = (id: string, label: string, icon: string) =>
  `<label class="panel-row">${rowIcon(icon, id)}<span class="row-text"><strong>${label}</strong></span><small class="row-count" id="layer-${id}-count"></small><input type="checkbox" role="switch" class="switch" id="layer-${id}"></label>`;
// Kinds are picked by their map pin, one big target each.
const kindPicks = Object.entries(markerKinds)
  .map(
    ([kind, { label }]) =>
      `<label class="kind-pick"><input type="radio" name="marker-kind" value="${kind}">${placeIcon(kind as keyof typeof markerKinds)}<span>${label}</span></label>`,
  )
  .join("");

// Map-first layout: almost nothing floats over the map.
//   top left      – Back
//   bottom pill   – Saved · View open a panel above it; Lock toggles the
//                   rotation lock in place; Add's + turns into × (close or
//                   cancel) while Place / Route, then the tap hint, float above
// Pinch and drag move the map, so there are no zoom or pan buttons.
export const viewerMarkup = `
<div class="map-stage" id="map-stage"><canvas id="map-canvas" tabindex="0" aria-label="Map: drag to pan; pinch, scroll or double-tap and drag to zoom; long-press to add a place. Arrows pan, plus and minus zoom, F fits."></canvas><div class="map-shade" aria-hidden="true"></div><svg id="search-overlay" class="search-overlay" aria-hidden="true" hidden></svg><svg id="map-overlay" class="map-overlay" aria-hidden="true"></svg></div>
<button class="glass corner-button corner-left" id="back" aria-label="Back to library">${icons.arrow}</button>
<p id="toast" class="toast glass" role="status" aria-live="polite" hidden></p>
<nav class="dock glass" id="dock" aria-label="Map menu">
  <button id="open-saved" data-sheet="saved" aria-controls="sheet" aria-expanded="false">${icons.list}<span>Saved</span></button>
  <button id="open-display" data-sheet="display" aria-controls="sheet" aria-expanded="false">${icons.layers}<span>View</span></button>
  <button id="open-search" data-sheet="search" aria-controls="sheet" aria-expanded="false">${icons.search}<span>Search</span></button>
  <button id="open-add" aria-controls="add-bar" aria-expanded="false">${icons.plus}<span id="open-add-label">Add</span></button>
  <button id="rotation-lock" aria-label="Unlock rotation" aria-pressed="true">${icons.rotationLock}<span>Lock</span></button>
</nav>
<div id="add-bar" class="add-bar" role="group" aria-label="Add to map" hidden>
  <button id="add-marker" class="add-choice places glass">${icons.pin}<span>Place</span></button>
  <button id="add-route" class="add-choice routes glass">${icons.route}<span>Route</span></button>
</div>
<div id="tool-bar" class="tool-bar glass" role="status" hidden>
  <p class="tool-hint"><strong id="tool-title"></strong><span id="tool-message"></span></p>
  <div id="tool-actions" class="tool-actions">
    <button id="route-undo" class="tool-undo" aria-label="Undo last point">${icons.undo}</button>
    <button id="tool-done" class="tool-done">${icons.check}<span>Done</span></button>
  </div>
</div>
<button id="sheet-dismiss" class="sheet-dismiss" aria-label="Close" tabindex="-1" hidden></button>
<section id="sheet" class="sheet" aria-labelledby="sheet-title" hidden>
  <div class="sheet-grabber" id="sheet-grabber"><span></span></div>
  <div class="sheet-header"><h2 id="sheet-title"></h2><button id="close-sheet" class="sheet-close" aria-label="Close">${icons.close}</button></div>
  <div class="sheet-content">
    <div id="sheet-search" data-panel="search" data-title="Search map text" hidden>
      <label class="search-label" for="map-search">Find text on this map</label>
      <div class="search-input-row"><input id="map-search" type="search" placeholder="Search map labels…" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="clear-search" class="sheet-close" aria-label="Clear search">${icons.close}</button></div>
      <p id="search-status" class="search-status" role="status" aria-live="polite"></p>
      <div class="search-navigation" id="search-navigation" hidden><button id="search-previous" class="secondary" aria-label="Previous result">${icons.arrow}</button><span id="search-result"></span><button id="search-next" class="secondary" aria-label="Next result">${icons.arrow}</button></div>
    </div>
    <div id="sheet-display" data-panel="display" data-title="View" hidden>
      <h3>Map</h3>
      <div class="panel-card">
        <label class="panel-row">${rowIcon(icons.moon)}<span class="row-text"><strong>Dark map</strong><small id="dark-status"></small></span><input type="checkbox" role="switch" class="switch" id="dark-map"></label>
        <div class="panel-row stacked">${rowIcon(icons.sun)}<span class="row-text"><strong>Brightness</strong></span><output id="dimming-value">100%</output><div class="row-slider"><input id="map-dimming" aria-label="Map brightness" type="range" min="20" max="100" step="5"></div></div>
        <div class="panel-row stacked" id="rotation-controls">${rowIcon(icons.rotateRight)}<span class="row-text"><strong>Rotation</strong></span><output id="rotation-value">0°</output><div class="row-slider"><button id="rotate-left" class="slider-step" aria-label="Rotate map left 15 degrees">${icons.rotateLeft}</button><input id="rotation-angle" aria-label="Map rotation" type="range" min="0" max="359" step="1"><button id="rotate-right" class="slider-step" aria-label="Rotate map right 15 degrees">${icons.rotateRight}</button></div></div>
      </div>
      <h3>Show on map</h3>
      <div class="panel-card">
        ${layerRow("routes", "Routes", icons.route)}
        ${layerRow("places", "Places", icons.pin)}
        ${layerRow("labels", "Names", icons.text)}
      </div>
      <button id="spotlight" class="panel-action spotlight-action">${icons.sparkle}<span>Highlight</span></button>
    </div>
    <div id="sheet-saved" data-panel="saved" data-title="Saved" hidden>
      <h3 class="section-title routes">${icons.route}<span>Routes</span><small id="saved-routes-count"></small></h3>
      <div id="route-list" class="panel-card navigation-list"></div>
      <h3 class="section-title places">${icons.pin}<span>Places</span><small id="saved-places-count"></small></h3>
      <div id="marker-list" class="panel-card navigation-list"></div>
    </div>
  </div>
</section>
<p id="viewer-error" class="viewer-error" role="alert" hidden></p>
<dialog id="marker-dialog" class="place-card"><form id="marker-form"><h2 id="marker-dialog-title">New place</h2><div class="kind-picker" role="radiogroup" aria-label="Kind">${kindPicks}</div><label class="place-name"><span>Name</span><input id="marker-label" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><button type="button" id="marker-add-note" class="add-note">${icons.plus}<span>Add note</span></button><label id="marker-note-field" class="place-note" hidden><span>Note</span><textarea id="marker-note" maxlength="2000" rows="2"></textarea></label><div class="dialog-actions"><button type="button" id="marker-delete" class="danger" hidden>Delete</button><button type="button" id="marker-cancel" class="secondary">Cancel</button><button type="submit" class="primary">Save</button></div></form></dialog>
<dialog id="name-dialog"><form id="name-form"><h2 id="name-title"></h2><label>Name<input id="name-input" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><div class="dialog-actions"><button type="button" id="name-cancel" class="secondary">Cancel</button><button type="submit" class="primary">Save</button></div></form></dialog>`;
