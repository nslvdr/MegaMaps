import { dialogHeader } from "./dialog";
import { icons } from "./icons";
import {
  BRIGHTNESS_LEVELS,
  DEFAULT_DIMMING,
  brightnessPercent,
  markerKinds,
} from "../viewer/navigation";
import { placeIcon } from "./place-icon";

// View settings use cards; Saved uses compact inset lists with row actions.
const rowIcon = (icon: string, tint = "") =>
  `<i class="row-icon ${tint}">${icon}</i>`;
// The whole icon tile toggles its layer through a native, keyboard-accessible input.
const layerToggle = (id: string, label: string, icon: string) =>
  `<label class="layer-toggle ${id}"><input type="checkbox" role="switch" id="layer-${id}" aria-label="${label}">${icon}<span>${label}</span><small class="layer-count" id="layer-${id}-count" aria-hidden="true"></small></label>`;
const brightnessChoices = BRIGHTNESS_LEVELS.map(
  (level) => `<label><input type="radio" name="map-brightness" id="brightness-${brightnessPercent(level)}" value="${level}"${level === DEFAULT_DIMMING ? " checked" : ""}><span>${brightnessPercent(level)}%</span></label>`,
).join("");
// Places are told apart by their map pin alone; names stay for screen readers and hover.
const kindPicks = Object.entries(markerKinds)
  .map(
    ([kind, { label }]) =>
      `<label class="kind-pick" title="${label}"><input type="radio" name="marker-kind" value="${kind}" aria-label="${label}">${placeIcon(kind as keyof typeof markerKinds)}</label>`,
  )
  .join("");

const undoKey = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "") ? "⌘Z" : "Ctrl+Z";

// Map-first layout: almost nothing floats over the map.
//   top corners   – Back on the left; View and rotation Lock on the right
//   bottom pill   – Saved · Search · Add; Saved and Add open panels like View.
//                   Placing, drawing or moving swaps the pill for a task card
//                   with the same header (icon, title, X) and full-size actions
// Pinch and drag move the map, so there are no zoom or pan buttons. The canvas
// takes its own keys, so it is an application: screen readers pass it arrows.
export const viewerMarkup = `
<div class="map-stage" id="map-stage"><canvas id="map-canvas" tabindex="0" role="application" aria-label="Map: drag to pan; pinch, scroll or double-tap and drag to zoom, two-finger tap to zoom out; long-press to add a place. Arrows pan, Shift for farther; plus and minus zoom, F fits, slash searches and Enter steps through matches. While adding, Enter puts the point in the middle."></canvas><div class="map-shade" aria-hidden="true"></div><div class="map-crosshair" aria-hidden="true">${icons.crosshair}</div><svg id="search-overlay" class="search-overlay" aria-hidden="true" hidden></svg><svg id="map-overlay" class="map-overlay" aria-hidden="true"></svg></div>
<button class="glass corner-button corner-left" id="back" aria-label="Back to library" title="Back to library (Esc)" aria-keyshortcuts="Escape">${icons.arrow}</button>
<div id="display-chips" class="display-chips" role="group" aria-label="Map view controls">
  <button id="rotation-lock" class="glass status-chip" aria-label="Unlock rotation" title="Unlock rotation" aria-pressed="true">${icons.rotationLock}</button>
  <button id="open-display" class="glass status-chip" data-sheet="display" aria-label="View settings" title="View settings" aria-controls="sheet" aria-expanded="false">${icons.sun}</button>
</div>
<div id="toast-bar" class="toast glass" hidden><p id="toast" role="status" aria-live="polite" hidden></p><button id="toast-undo" class="toast-undo" hidden>${icons.undo}<span>Undo</span></button></div>
<nav class="dock glass" id="dock" aria-label="Map menu">
  <button id="open-saved" data-sheet="saved" aria-label="Saved" title="Saved" aria-controls="sheet" aria-expanded="false">${icons.saved}</button>
  <div id="open-search" class="search-field" tabindex="-1" title="Search (/)" aria-keyshortcuts="/">${icons.search}<input id="map-search" type="search" aria-label="Search map text and saved places" aria-describedby="search-status" aria-controls="search-overlay" aria-expanded="false" placeholder="Search map…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button type="button" id="search-count" class="search-count" title="Next match (Enter)" hidden></button><button type="button" id="search-close" class="search-close" aria-label="Close search" title="Close (Esc)" hidden>${icons.close}</button></div>
  <button id="open-add" aria-label="Add" title="Add" data-sheet="add" aria-controls="sheet" aria-expanded="false">${icons.add}</button>
</nav>
<p id="search-status" class="search-status" role="status" aria-live="polite"></p>
<section id="tool-bar" class="tool-bar" aria-labelledby="tool-title" hidden>
  <div class="sheet-header"><span id="tool-icon" class="dialog-title-icon" aria-hidden="true"></span><h2 id="tool-title"></h2><button type="button" id="tool-rename" class="dialog-edit" aria-label="Rename route" title="Rename route" hidden>${icons.edit}</button><button type="button" id="tool-cancel" class="dialog-close" aria-label="Cancel" title="Cancel">${icons.close}</button></div>
  <p id="tool-message" class="tool-hint" role="status"></p>
  <div id="tool-actions" class="dialog-actions tool-actions">
    <button type="button" id="route-undo" class="quiet" title="Undo (${undoKey})" aria-keyshortcuts="Meta+Z Control+Z Backspace">${icons.undo}<span>Undo</span></button>
    <button type="button" id="tool-done" class="primary">${icons.check}<span>Done</span></button>
  </div>
</section>
<button id="sheet-dismiss" class="sheet-dismiss" aria-label="Close" tabindex="-1" hidden></button>
<section id="sheet" class="sheet" aria-labelledby="sheet-title" hidden>
  <div class="sheet-header"><span id="sheet-title-icon" class="dialog-title-icon" aria-hidden="true"></span><h2 id="sheet-title"></h2><button id="share-saved" class="sheet-share" aria-label="Share map or selected items" hidden>${icons.share}</button><button id="close-sheet" class="sheet-close" aria-label="Close">${icons.close}</button></div>
  <div class="sheet-content">
    <div id="sheet-display" data-panel="display" data-title="View" hidden>
      <h3>Map</h3>
      <div class="panel-card">
        <label class="panel-row">${rowIcon(icons.moon)}<span class="row-text"><strong>Dark map</strong><small id="dark-status"></small></span><input type="checkbox" role="switch" class="switch" id="dark-map"></label>
        <div class="panel-row stacked">${rowIcon(icons.sun)}<span class="row-text"><strong>Brightness</strong><small id="brightness-help">Dim the map so routes and places stand out.</small></span><div class="brightness-options" role="radiogroup" aria-label="Map brightness" aria-describedby="brightness-help">${brightnessChoices}</div></div>
      </div>
      <h3>Show on map</h3>
      <div class="layer-toggles" role="group" aria-label="Show on map">
        ${layerToggle("routes", "Routes", icons.route)}
        ${layerToggle("places", "Places", icons.pin)}
        ${layerToggle("labels", "Names", icons.text)}
      </div>
      <button id="spotlight" class="panel-action spotlight-action" title="Dim the map for a moment and pulse every route and place, even hidden ones">${icons.sparkle}<span>Highlight saved</span></button>
    </div>
    <div id="sheet-saved" data-panel="saved" data-title="Saved" hidden>
      <h3 id="saved-routes-title" class="section-title routes">${icons.route}<span>Routes</span><small id="saved-routes-count"></small></h3>
      <ul id="route-list" class="navigation-list" aria-labelledby="saved-routes-title"></ul>
      <h3 id="saved-places-title" class="section-title places">${icons.pin}<span>Places</span><small id="saved-places-count"></small></h3>
      <ul id="marker-list" class="navigation-list" aria-labelledby="saved-places-title"></ul>
    </div>
    <div id="sheet-add" data-panel="add" data-title="Add" hidden>
      <div class="add-choices">
        <button id="add-marker" class="add-choice places">${icons.pin}<span>Place</span></button>
        <button id="add-route" class="add-choice routes">${icons.route}<span>Route</span></button>
      </div>
    </div>
  </div>
</section>
<p id="viewer-error" class="viewer-error" role="alert" hidden></p>
<dialog id="marker-dialog" class="place-card" aria-labelledby="marker-dialog-title">
  <div class="dialog-header"><span id="marker-dialog-title-icon" class="dialog-title-icon" aria-hidden="true">${icons.pin}</span><h2 id="marker-dialog-title">New place</h2><button type="button" id="marker-edit" class="dialog-edit" aria-label="Edit place" title="Edit place" hidden>${icons.edit}</button><button type="button" id="marker-cancel" class="dialog-close" aria-label="Close" title="Close">${icons.close}</button></div>
  <div id="marker-details" class="place-details" role="region" aria-label="Place details" hidden>
    <div class="place-detail-track"><div class="place-detail-content">
      <div id="marker-detail-photos" class="place-photos" role="group" aria-label="Photos" hidden></div>
      <p id="marker-detail-description" class="place-detail-description"></p>
    </div></div>
  </div>
  <form id="marker-form"><div class="kind-picker" role="radiogroup" aria-label="Icon">${kindPicks}</div><label class="place-name"><span>Name</span><input id="marker-label" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><label class="place-description"><span>Description</span><textarea id="marker-description" maxlength="2000" rows="3"></textarea></label><div id="marker-photos-field" class="place-photos-field" hidden><span id="marker-photos-title">Photos</span><ul id="marker-photo-list" class="photo-thumbs" aria-labelledby="marker-photos-title"></ul></div><button type="button" id="marker-add-photos" class="place-add">${icons.photo}<span>Add photos</span></button><input type="file" id="marker-photo-input" accept="image/*" multiple hidden><div class="dialog-actions"><button type="submit" id="marker-save" class="primary">${icons.check}<span>Save</span></button><button type="button" id="marker-delete" class="quiet danger" hidden>${icons.trash}<span>Delete</span></button><button type="button" id="marker-move" class="quiet" hidden>${icons.move}<span>Move</span></button></div></form>
</dialog>
<dialog id="photo-viewer" class="photo-viewer" aria-label="Photos"><div class="photo-viewer-stage"><div class="photo-viewer-track"></div></div><button type="button" id="photo-viewer-close" class="dialog-close" aria-label="Close" title="Close">${icons.close}</button></dialog>
<dialog id="name-dialog" aria-labelledby="name-title"><form id="name-form">${dialogHeader("name-title", "", icons.edit, "name-cancel")}<label>Name<input id="name-input" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><div class="dialog-actions"><button type="submit" class="primary">${icons.check}<span>Save</span></button></div></form></dialog>`;
