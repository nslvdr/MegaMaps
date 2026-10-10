import { icons } from "./icons";
import { BRIGHTNESS_LEVELS, DEFAULT_DIMMING, markerKinds } from "../viewer/navigation";
import { placeIcon } from "./place-icon";

// View settings use cards; Saved uses compact inset lists with row actions.
const rowIcon = (icon: string, tint = "") =>
  `<i class="row-icon ${tint}">${icon}</i>`;
// The whole icon tile toggles its layer through a native, keyboard-accessible input.
const layerToggle = (id: string, label: string, icon: string) =>
  `<label class="layer-toggle ${id}"><input type="checkbox" role="switch" id="layer-${id}" aria-label="${label}">${icon}<span>${label}</span><small class="layer-count" id="layer-${id}-count" aria-hidden="true"></small></label>`;
const brightnessChoices = BRIGHTNESS_LEVELS.map(
  (level) => `<label><input type="radio" name="map-brightness" id="brightness-${level * 100}" value="${level}"${level === DEFAULT_DIMMING ? " checked" : ""}><span>${level * 100}%</span></label>`,
).join("");
// Kinds are picked by their map pin, one big target each.
const kindPicks = Object.entries(markerKinds)
  .map(
    ([kind, { label }]) =>
      `<label class="kind-pick"><input type="radio" name="marker-kind" value="${kind}">${placeIcon(kind as keyof typeof markerKinds)}<span>${label}</span></label>`,
  )
  .join("");

const undoKey = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "") ? "⌘Z" : "Ctrl+Z";

// Map-first layout: almost nothing floats over the map.
//   top left      – Back
//   bottom pill   – Saved · View open a panel above it; Lock toggles the
//                   rotation lock in place; Add's + turns into × (close or
//                   cancel) while Place / Route, then the tap hint, float above
// Pinch and drag move the map, so there are no zoom or pan buttons. The canvas
// takes its own keys, so it is an application: screen readers pass it arrows.
export const viewerMarkup = `
<div class="map-stage" id="map-stage"><canvas id="map-canvas" tabindex="0" role="application" aria-label="Map: drag to pan; pinch, scroll or double-tap and drag to zoom, two-finger tap to zoom out; long-press to add a place. Arrows pan, Shift for farther; plus and minus zoom, F fits, slash searches and Enter steps through matches; brackets rotate when unlocked."></canvas><div class="map-shade" aria-hidden="true"></div><svg id="search-overlay" class="search-overlay" aria-hidden="true" hidden></svg><svg id="map-overlay" class="map-overlay" aria-hidden="true"></svg></div>
<button class="glass corner-button corner-left" id="back" aria-label="Back to library" title="Back to library (Esc)" aria-keyshortcuts="Escape">${icons.arrow}</button>
<p id="toast" class="toast glass" role="status" aria-live="polite" hidden></p>
<nav class="dock glass" id="dock" aria-label="Map menu">
  <button id="open-saved" data-sheet="saved" aria-controls="sheet" aria-expanded="false">${icons.list}<span>Saved</span></button>
  <button id="open-display" data-sheet="display" aria-controls="sheet" aria-expanded="false">${icons.layers}<span>View</span></button>
  <button id="open-search" data-sheet="search" aria-controls="sheet" aria-expanded="false" title="Search (/)" aria-keyshortcuts="/">${icons.search}<span>Search</span></button>
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
    <button id="route-undo" class="tool-undo" aria-label="Undo last point" title="Undo (${undoKey})" aria-keyshortcuts="Meta+Z Control+Z Backspace">${icons.undo}</button>
    <button id="tool-done" class="tool-done">${icons.check}<span>Done</span></button>
  </div>
</div>
<button id="sheet-dismiss" class="sheet-dismiss" aria-label="Close" tabindex="-1" hidden></button>
<section id="sheet" class="sheet" aria-labelledby="sheet-title" hidden>
  <div class="sheet-grabber" id="sheet-grabber"><span></span></div>
  <div class="sheet-header"><h2 id="sheet-title"></h2><button id="share-saved" class="sheet-share" aria-label="Share map or selected items" hidden>${icons.share}</button><button id="close-sheet" class="sheet-close" aria-label="Close">${icons.close}</button></div>
  <div class="sheet-content">
    <div id="sheet-search" data-panel="search" data-title="Search this map" hidden>
      <div class="search-field glass">${icons.search}<input id="map-search" type="search" aria-label="Search map text and saved places" aria-describedby="search-status" placeholder="Search text and places…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><span id="search-count" class="search-count" hidden></span></div>
      <p id="search-status" class="search-status" role="status" aria-live="polite"></p>
    </div>
    <div id="sheet-display" data-panel="display" data-title="View" hidden>
      <h3>Map</h3>
      <div class="panel-card">
        <label class="panel-row">${rowIcon(icons.moon)}<span class="row-text"><strong>Dark map</strong><small id="dark-status"></small></span><input type="checkbox" role="switch" class="switch" id="dark-map"></label>
        <div class="panel-row stacked">${rowIcon(icons.sun)}<span class="row-text"><strong>Brightness</strong></span><div class="brightness-options" role="radiogroup" aria-label="Map brightness">${brightnessChoices}</div></div>
        <div class="panel-row stacked" id="rotation-controls">${rowIcon(icons.rotateRight)}<span class="row-text"><strong>Rotation</strong></span><output id="rotation-value">0°</output><div class="row-slider"><button id="rotate-left" class="slider-step" aria-label="Rotate map left 15 degrees" title="Rotate left ([)" aria-keyshortcuts="[">${icons.rotateLeft}</button><input id="rotation-angle" aria-label="Map rotation" type="range" min="0" max="359" step="1"><button id="rotate-right" class="slider-step" aria-label="Rotate map right 15 degrees" title="Rotate right (])" aria-keyshortcuts="]">${icons.rotateRight}</button></div></div>
      </div>
      <h3>Show on map</h3>
      <div class="layer-toggles" role="group" aria-label="Show on map">
        ${layerToggle("routes", "Routes", icons.route)}
        ${layerToggle("places", "Places", icons.pin)}
        ${layerToggle("labels", "Names", icons.text)}
      </div>
      <button id="spotlight" class="panel-action spotlight-action">${icons.sparkle}<span>Highlight</span></button>
    </div>
    <div id="sheet-saved" data-panel="saved" data-title="Saved" hidden>
      <h3 id="saved-routes-title" class="section-title routes">${icons.route}<span>Routes</span><small id="saved-routes-count"></small></h3>
      <ul id="route-list" class="navigation-list" aria-labelledby="saved-routes-title"></ul>
      <h3 id="saved-places-title" class="section-title places">${icons.pin}<span>Places</span><small id="saved-places-count"></small></h3>
      <ul id="marker-list" class="navigation-list" aria-labelledby="saved-places-title"></ul>
    </div>
  </div>
</section>
<p id="viewer-error" class="viewer-error" role="alert" hidden></p>
<dialog id="marker-dialog" class="place-card"><form id="marker-form"><h2 id="marker-dialog-title">New place</h2><div class="kind-picker" role="radiogroup" aria-label="Kind">${kindPicks}</div><label class="place-name"><span>Name</span><input id="marker-label" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><button type="button" id="marker-add-note" class="add-note">${icons.plus}<span>Add note</span></button><label id="marker-note-field" class="place-note" hidden><span>Note</span><textarea id="marker-note" maxlength="2000" rows="2"></textarea></label><div class="dialog-actions"><button type="submit" class="primary">${icons.check}<span>Save</span></button><button type="button" id="marker-delete" class="quiet danger" hidden>${icons.trash}<span>Delete</span></button><button type="button" id="marker-cancel" class="quiet">${icons.close}<span>Cancel</span></button></div></form></dialog>
<dialog id="name-dialog"><form id="name-form"><h2 id="name-title"></h2><label>Name<input id="name-input" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><div class="dialog-actions"><button type="submit" class="primary">${icons.check}<span>Save</span></button><button type="button" id="name-cancel" class="quiet">${icons.close}<span>Cancel</span></button></div></form></dialog>`;
