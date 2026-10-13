import { dialogHeader } from "./dialog";
import { icons } from "./icons";
import { t } from "../i18n";
import {
  BRIGHTNESS_LEVELS,
  DEFAULT_DIMMING,
  brightnessPercent,
  markerKinds,
  NORTH_MAX,
  NORTH_MIN,
  type RotationMode,
} from "../viewer/navigation";
import { placeIcon } from "./place-icon";

// View settings use cards; Saved uses compact inset lists with row actions.
const rowIcon = (icon: string, tint = "") =>
  `<i class="row-icon ${tint}">${icon}</i>`;
// The whole icon tile toggles its layer through a native, keyboard-accessible input.
const layerToggle = (id: string, label: string, icon: string) =>
  `<label class="layer-toggle ${id}"><input type="checkbox" role="switch" id="layer-${id}" aria-label="${label}">${icon}<span>${label}</span><small class="layer-count" id="layer-${id}-count" aria-hidden="true"></small></label>`;
const rotationChoice = (mode: RotationMode, label: string, icon: string) =>
  `<label class="layer-toggle"><input type="radio" name="rotation-mode" id="rotation-${mode}" value="${mode}">${icon}<span>${label}</span></label>`;
// A wheel of whole degrees, like the iOS Clock picker; the middle one is chosen.
const northDegrees = Array.from({ length: NORTH_MAX - NORTH_MIN + 1 }, (_, i) =>
  `<span aria-hidden="true">${String(NORTH_MIN + i).replace("-", "−")}°</span>`).join("");
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

// Map-first layout: almost nothing floats over the map.
//   top corners   – Back on the left; Rotation and View on the right, both panels
//   bottom pill   – Saved · Search · Add; Saved and Add open panels like View.
//                   Placing, drawing or moving swaps the pill for a task card
//                   with the same header (icon, title, X) and full-size actions
// Pinch and drag move the map, so there are no zoom or pan buttons.
export const viewerMarkup = `
<div class="map-stage" id="map-stage"><canvas id="map-canvas" role="img" aria-label="${t("Map: drag to pan; pinch or double-tap and drag to zoom, two-finger tap to zoom out; long-press to add a place.")}"></canvas><div class="map-shade" aria-hidden="true"></div><svg id="search-overlay" class="search-overlay" aria-hidden="true" hidden></svg><svg id="map-overlay" class="map-overlay" aria-hidden="true"></svg></div>
<button class="glass corner-button corner-left" id="back" aria-label="${t("Back to library")}" title="${t("Back to library")}">${icons.arrow}</button>
<div id="display-chips" class="display-chips" role="group" aria-label="${t("Map view controls")}">
  <button id="open-rotation" class="glass status-chip" data-sheet="rotation" aria-label="${t("Rotation")}" title="${t("Rotation")}" aria-controls="sheet" aria-expanded="false">${icons.rotationLock}</button>
  <button id="open-display" class="glass status-chip" data-sheet="display" aria-label="${t("View settings")}" title="${t("View settings")}" aria-controls="sheet" aria-expanded="false">${icons.sun}</button>
</div>
<div class="toasts"><div id="ocr-progress" class="toast glass" data-tone="progress" role="progressbar" aria-label="${t("Finding text")}" aria-valuemin="0" aria-valuemax="100" hidden>${icons.scanText}<p>${t("Finding text")}</p><span id="ocr-percent" class="ocr-percent">0%</span></div><div id="toast-bar" class="toast glass" hidden><span id="toast-icon" class="toast-icon" aria-hidden="true"></span><p id="toast" role="status" aria-live="polite" hidden></p><button id="toast-undo" class="toast-undo" hidden>${icons.undo}<span>${t("Undo")}</span></button></div></div>
<nav class="dock glass" id="dock" aria-label="${t("Map menu")}">
  <button id="open-saved" data-sheet="saved" aria-label="${t("Saved")}" title="${t("Saved")}" aria-controls="sheet" aria-expanded="false">${icons.saved}</button>
  <div id="open-search" class="search-field" title="${t("Search")}">${icons.search}<input id="map-search" type="search" aria-label="${t("Search map text and saved places")}" aria-describedby="search-status" aria-controls="search-overlay" aria-expanded="false" placeholder="${t("Search map…")}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button type="button" id="search-count" class="search-count" title="${t("Next match")}" hidden></button><button type="button" id="search-close" class="search-close" aria-label="${t("Close search")}" title="${t("Close")}" hidden>${icons.close}</button></div>
  <button id="open-add" aria-label="${t("Add")}" title="${t("Add")}" data-sheet="add" aria-controls="sheet" aria-expanded="false">${icons.add}</button>
</nav>
<p id="search-status" class="search-status" role="status" aria-live="polite"></p>
<section id="tool-bar" class="tool-bar" aria-labelledby="tool-title" hidden>
  <div class="sheet-header"><span id="tool-icon" class="dialog-title-icon" aria-hidden="true"></span><h2 id="tool-title"></h2><button type="button" id="tool-rename" class="dialog-edit" aria-label="${t("Rename route")}" title="${t("Rename route")}" hidden>${icons.edit}</button><button type="button" id="tool-cancel" class="dialog-close" aria-label="${t("Cancel")}" title="${t("Cancel")}">${icons.close}</button></div>
  <p id="tool-message" class="tool-hint" role="status"></p>
  <div id="tool-actions" class="dialog-actions tool-actions">
    <button type="button" id="route-undo" class="quiet">${icons.undo}<span>${t("Undo")}</span></button>
    <button type="button" id="tool-done" class="primary">${icons.check}<span>${t("Done")}</span></button>
  </div>
</section>
<button id="sheet-dismiss" class="sheet-dismiss" aria-label="${t("Close")}" hidden></button>
<section id="sheet" class="sheet" aria-labelledby="sheet-title" hidden>
  <div class="sheet-header"><span id="sheet-title-icon" class="dialog-title-icon" aria-hidden="true"></span><h2 id="sheet-title"></h2><button id="share-saved" class="sheet-share" aria-label="${t("Share map or selected items")}" hidden>${icons.share}</button><button id="reset-rotation" class="sheet-reset" aria-label="${t("Reset rotation to 0°")}" title="${t("Reset rotation to 0°")}" hidden>${icons.undo}</button><button id="close-sheet" class="sheet-close" aria-label="${t("Close")}">${icons.close}</button></div>
  <div class="sheet-content">
    <div id="sheet-display" data-panel="display" data-title="${t("View")}" hidden>
      <h3>${t("Map")}</h3>
      <div class="panel-card">
        <label class="panel-row">${rowIcon(icons.moon)}<span class="row-text"><strong>${t("Dark map")}</strong><small id="dark-status"></small></span><input type="checkbox" role="switch" class="switch" id="dark-map"></label>
        <div class="panel-row stacked">${rowIcon(icons.sun)}<span class="row-text"><strong>${t("Brightness")}</strong><small id="brightness-help">${t("Dim the map so routes and places stand out.")}</small></span><div class="brightness-options" role="radiogroup" aria-label="${t("Map brightness")}" aria-describedby="brightness-help">${brightnessChoices}</div></div>
      </div>
      <h3>${t("Show on map")}</h3>
      <div class="layer-toggles" role="group" aria-label="${t("Show on map")}">
        ${layerToggle("routes", t("Routes"), icons.route)}
        ${layerToggle("places", t("Places"), icons.pin)}
        ${layerToggle("labels", t("Names"), icons.text)}
      </div>
      <button id="spotlight" class="panel-action spotlight-action" title="${t("Dim the map for a moment and pulse every route and place, even hidden ones")}">${icons.sparkle}<span>${t("Highlight saved")}</span></button>
    </div>
    <div id="sheet-rotation" data-panel="rotation" data-title="${t("Rotation")}" hidden>
      <div class="layer-toggles rotation-modes" role="radiogroup" aria-label="${t("Rotation")}" aria-describedby="rotation-help">
        ${rotationChoice("free", t("Normal"), icons.freeRotation)}
        ${rotationChoice("compass", t("Auto"), icons.compass)}
        ${rotationChoice("locked", t("Locked"), icons.rotationLock)}
      </div>
      <p id="rotation-help" class="field-help" role="status"></p>
      <div id="north-field" class="panel-card" hidden>
        <div class="panel-row">${rowIcon(icons.north)}<span class="row-text"><strong id="north-label">${t("North")}</strong><small id="north-help">${t("Clockwise from map top")}</small></span><div class="north-wheel"><div id="north-offset" class="north-track" role="spinbutton" aria-labelledby="north-label" aria-describedby="north-help" aria-valuemin="${NORTH_MIN}" aria-valuemax="${NORTH_MAX}">${northDegrees}</div></div></div>
      </div>
    </div>
    <div id="sheet-saved" data-panel="saved" data-title="${t("Saved")}" hidden>
      <h3 id="saved-routes-title" class="section-title routes">${icons.route}<span>${t("Routes")}</span><small id="saved-routes-count"></small></h3>
      <ul id="route-list" class="navigation-list" aria-labelledby="saved-routes-title"></ul>
      <h3 id="saved-places-title" class="section-title places">${icons.pin}<span>${t("Places")}</span><small id="saved-places-count"></small></h3>
      <ul id="marker-list" class="navigation-list" aria-labelledby="saved-places-title"></ul>
    </div>
    <div id="sheet-add" data-panel="add" data-title="${t("Add")}" hidden>
      <div class="add-choices">
        <button id="add-marker" class="add-choice places">${icons.pin}<span>${t("Place")}</span></button>
        <button id="add-route" class="add-choice routes">${icons.route}<span>${t("Route")}</span></button>
      </div>
    </div>
  </div>
</section>
<dialog id="marker-dialog" class="place-card" aria-labelledby="marker-dialog-title">
  <div class="dialog-header"><span id="marker-dialog-title-icon" class="dialog-title-icon" aria-hidden="true">${icons.pin}</span><h2 id="marker-dialog-title">${t("New place")}</h2><button type="button" id="marker-edit" class="dialog-edit" aria-label="${t("Edit place")}" title="${t("Edit place")}" hidden>${icons.edit}</button><button type="button" id="marker-cancel" class="dialog-close" aria-label="${t("Close")}" title="${t("Close")}">${icons.close}</button></div>
  <div id="marker-details" class="place-details" role="region" aria-label="${t("Place details")}" hidden>
    <div class="place-detail-track"><div class="place-detail-content">
      <div id="marker-detail-photos" class="place-photos" role="group" aria-label="${t("Photos")}" hidden></div>
      <p id="marker-detail-description" class="place-detail-description"></p>
    </div></div>
  </div>
  <form id="marker-form"><div id="marker-kinds" class="kind-picker" role="radiogroup" aria-label="${t("Icon")}">${kindPicks}</div><label class="place-name"><span>${t("Name")}</span><input id="marker-label" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><label class="place-description"><span>${t("Description")}</span><textarea id="marker-description" maxlength="2000" rows="3"></textarea></label><div id="marker-photos-field" class="place-photos-field" hidden><span id="marker-photos-title">${t("Photos")}</span><ul id="marker-photo-list" class="photo-thumbs" aria-labelledby="marker-photos-title"></ul></div><button type="button" id="marker-add-photos" class="place-add">${icons.photo}<span>${t("Add photos")}</span></button><input type="file" id="marker-photo-input" accept="image/*" multiple hidden><div class="dialog-actions"><button type="submit" id="marker-save" class="primary">${icons.check}<span>${t("Save")}</span></button><button type="button" id="marker-delete" class="quiet danger" hidden>${icons.trash}<span>${t("Delete")}</span></button><button type="button" id="marker-move" class="quiet" hidden>${icons.move}<span>${t("Move")}</span></button><button type="button" id="route-points" class="quiet" hidden>${icons.route}<span>${t("Edit points")}</span></button></div></form>
</dialog>
<dialog id="photo-viewer" class="photo-viewer" aria-label="${t("Photos")}"><div class="photo-viewer-stage"><div class="photo-viewer-track"></div></div><button type="button" id="photo-viewer-close" class="dialog-close" aria-label="${t("Close")}" title="${t("Close")}">${icons.close}</button></dialog>
<dialog id="name-dialog" aria-labelledby="name-title"><form id="name-form">${dialogHeader("name-title", "", icons.edit, "name-cancel")}<label>${t("Name")}<input id="name-input" required maxlength="100" autocomplete="off" enterkeyhint="done"></label><div class="dialog-actions"><button type="submit" class="primary">${icons.check}<span>${t("Save")}</span></button></div></form></dialog>`;
