import { dialogHeader } from "./dialog";
import { icons } from "./icons";
import { locale, t } from "../i18n";
import { speedDelays } from "../viewer/compass";
import {
  BRIGHTNESS_LEVELS,
  DEFAULT_DIMMING,
  brightnessPercent,
  dangerLevels,
  markerKinds,
  NORTH_MAX,
  NORTH_MIN,
  placeColor,
  waterLevels,
} from "../viewer/navigation";
import { placeIcon, waterColors } from "./place-icon";

// View settings use cards; Saved uses compact inset lists with row actions.
const rowIcon = (icon: string, tint = "") =>
  `<i class="row-icon ${tint}">${icon}</i>`;
// The whole icon tile toggles its layer through a native, keyboard-accessible input.
const layerToggle = (id: string, label: string, icon: string) =>
  `<label class="layer-toggle ${id}"><input type="checkbox" role="switch" id="layer-${id}" aria-label="${label}">${icon}<span>${label}</span><small class="layer-count" id="layer-${id}-count" aria-hidden="true"></small></label>`;
// Rotation is one set of tiles: each is a mode, or Compass mode with how it follows.
const rotationChoice = (id: string, label: string, icon: string) =>
  `<label class="layer-toggle"><input type="radio" name="rotation" id="${id}">${icon}<span>${label}</span></label>`;
// Auto's speeds, slowest first: each row says how long a heading must hold.
const holds = (speed: keyof typeof speedDelays) =>
  t("Turns after {seconds} s in the same direction.", { seconds: (speedDelays[speed] / 1000).toLocaleString(locale) });
const speedChoices = ([
  ["mid", t("Mid"), holds("mid"), icons.speedMid],
  ["high", t("High"), holds("high"), icons.speedHigh],
  ["live", t("Live"), `${t("Turns instantly.")}<span class="warning">${t("Very hungry for battery.")}</span>`, icons.speedLive],
] as const).map(([speed, label, help, icon]) =>
  `<label class="panel-row choice-row"><input type="radio" name="compass-speed" id="compass-speed-${speed}">${rowIcon(icon)}<span class="row-text"><strong>${label}</strong><small>${help}</small></span><i class="choice-check">${icons.check}</i></label>`).join("");
// A wheel of whole degrees, like the iOS Clock picker; the middle one is chosen.
const northDegrees = Array.from({ length: NORTH_MAX - NORTH_MIN + 1 }, (_, i) =>
  `<span aria-hidden="true">${String(NORTH_MIN + i).replace("-", "−")}°</span>`).join("");
const brightnessChoices = BRIGHTNESS_LEVELS.map(
  (level) => `<label><input type="radio" name="map-brightness" id="brightness-${brightnessPercent(level)}" value="${level}"${level === DEFAULT_DIMMING ? " checked" : ""}><span>${brightnessPercent(level)}%</span></label>`,
).join("");
// The form shows the chosen pin; tapping it opens every pin, named, in a modal.
const kindPicks = Object.entries(markerKinds)
  .map(
    ([kind, { label }]) =>
      `<label class="kind-pick"><input type="radio" name="marker-kind" value="${kind}">${placeIcon(kind as keyof typeof markerKinds)}<span>${label}</span></label>`,
  )
  .join("");
// Only shown for flooded places; tapping the chosen step again clears it.
const waterSteps = ([1, 2, 3] as const)
  .map((level) =>
    `<button type="button" class="level-step" data-water="${level}" aria-pressed="false" style="--level: ${waterColors[level]}">${placeIcon("flooded", { water: level })}<span>${waterLevels[level]}</span></button>`)
  .join("");
// Only shown for danger places; one step is always chosen.
const dangerSteps = ([1, 2] as const)
  .map((level) =>
    `<button type="button" class="level-step" data-danger="${level}" aria-pressed="false" style="--level: ${placeColor({ kind: "unstable", danger: level })}">${placeIcon("unstable", { danger: level })}<span>${dangerLevels[level]}</span></button>`)
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
  <button id="open-measure" class="glass status-chip" aria-label="${t("Measure")}" title="${t("Measure")}" aria-pressed="false">${icons.measure}</button>
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
  <p id="tool-total" class="tool-total" hidden></p>
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
        <div class="panel-row stacked">${rowIcon(icons.sun)}<span class="row-text"><strong>${t("Brightness")}</strong><small id="brightness-help">${t("Dim the map so routes and places stand out.")}</small></span><div class="option-pills" role="radiogroup" aria-label="${t("Map brightness")}" aria-describedby="brightness-help">${brightnessChoices}</div></div>
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
      <h3 id="rotation-hand-title">${t("By hand")}</h3>
      <div class="layer-toggles rotation-modes" role="radiogroup" aria-labelledby="rotation-hand-title" aria-describedby="rotation-help">
        ${rotationChoice("rotation-free", t("Manual"), icons.freeRotation)}
        ${rotationChoice("rotation-locked", t("Locked"), icons.rotationLock)}
      </div>
      <h3 id="rotation-compass-title">${t("With the compass")}</h3>
      <div class="layer-toggles rotation-modes" role="radiogroup" aria-labelledby="rotation-compass-title" aria-describedby="rotation-help">
        ${rotationChoice("compass-follow-tap", t("Tap"), icons.followTap)}
        ${rotationChoice("compass-follow-auto", t("Auto"), icons.compass)}
      </div>
      <p id="rotation-help" class="field-help" role="status"></p>
      <div id="speed-field" hidden>
        <h3 id="speed-label">${t("Speed")}</h3>
        <div class="panel-card" role="radiogroup" aria-labelledby="speed-label">${speedChoices}</div>
      </div>
      <div id="north-field" class="panel-card" hidden>
        <div class="panel-row">${rowIcon(icons.north)}<span class="row-text"><strong id="north-label">${t("North offset")}</strong><small id="north-help">${t("Turn clockwise if the map’s top isn’t north")}</small></span><div class="north-wheel"><div id="north-offset" class="north-track" role="spinbutton" aria-labelledby="north-label" aria-describedby="north-help" aria-valuemin="${NORTH_MIN}" aria-valuemax="${NORTH_MAX}">${northDegrees}</div></div></div>
      </div>
    </div>
    <div id="sheet-saved" data-panel="saved" data-title="${t("Saved")}" hidden>
      <h3 id="saved-routes-title" class="section-title routes">${icons.route}<span>${t("Routes")}</span><small id="saved-routes-count"></small><button id="routes-order" class="section-menu" aria-label="${t("Order routes")}" aria-haspopup="menu" aria-expanded="false">${icons.filter}</button></h3>
      <ul id="route-list" class="navigation-list" aria-labelledby="saved-routes-title"></ul>
      <h3 id="saved-places-title" class="section-title places">${icons.pin}<span>${t("Places")}</span><small id="saved-places-count"></small><button id="places-order" class="section-menu" aria-label="${t("Order and filter places")}" aria-haspopup="menu" aria-expanded="false">${icons.filter}</button></h3>
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
  <div class="dialog-header"><span id="marker-dialog-title-icon" class="dialog-title-icon" aria-hidden="true">${icons.pin}</span><div class="place-heading"><h2 id="marker-dialog-title">${t("New place")}</h2><p id="marker-detail-seen" class="place-seen" hidden></p></div><button type="button" id="marker-add-entry" class="dialog-edit" aria-label="${t("Add journal entry")}" title="${t("Add journal entry")}" hidden>${icons.log}</button><button type="button" id="marker-edit" class="dialog-edit" aria-label="${t("Edit place")}" title="${t("Edit place")}" hidden>${icons.edit}</button><button type="button" id="marker-cancel" class="dialog-close" aria-label="${t("Close")}" title="${t("Close")}">${icons.close}</button></div>
  <div id="marker-seen-ask" class="seen-ask" role="group" aria-labelledby="marker-seen-question" hidden><span id="marker-seen-question">${t("Seen today?")}</span><button type="button" id="marker-seen-no" class="quiet">${t("No")}</button><button type="button" id="marker-seen-yes" class="primary">${icons.check}<span>${t("Yes")}</span></button></div>
  <div id="marker-details" class="place-details" role="region" aria-label="${t("Place details")}" hidden>
    <div id="marker-detail-photos" class="place-photos" role="group" aria-label="${t("Photos")}" hidden></div>
    <p id="marker-detail-level" class="place-detail-level" hidden></p>
    <p id="marker-detail-description" class="place-detail-description"></p>
    <section id="marker-detail-log" class="place-log" aria-labelledby="marker-log-heading" hidden>
      <h3 id="marker-log-heading">${t("Journal")}</h3>
      <ol id="marker-log-list" class="place-log-list"></ol>
    </section>
  </div>
  <span class="place-more" aria-hidden="true">${icons.chevronDown}</span>
  <form id="marker-form"><div id="marker-kinds" class="kind-field"><span id="marker-kind-title">${t("Icon and type")}</span><button type="button" id="marker-kind-toggle" class="kind-toggle" aria-haspopup="dialog" aria-controls="kind-dialog" aria-labelledby="marker-kind-title marker-kind-current"><span id="marker-kind-current" class="kind-current"></span><span class="kind-change">${t("Change")}${icons.arrow}</span></button></div><div id="marker-water" class="level-picker" role="group" aria-labelledby="marker-water-title" hidden><span id="marker-water-title">${t("Water level")}</span><div class="level-steps">${waterSteps}</div></div><div id="marker-danger" class="level-picker" role="group" aria-labelledby="marker-danger-title" hidden><span id="marker-danger-title">${t("Danger level")}</span><div class="level-steps">${dangerSteps}</div></div><label class="place-name"><span>${t("Name")}</span><input id="marker-label" required maxlength="100" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next"></label><label class="place-description"><span>${t("Description")}</span><textarea id="marker-description" maxlength="2000" rows="3"></textarea></label><label id="marker-seen-field" hidden><span>${t("Last seen")}</span><input id="marker-seen-date" type="date"></label><div id="marker-log-field" class="place-photos-field" hidden><span id="marker-log-title">${t("Journal")}</span><ol id="marker-log-edit" class="place-log-list" aria-labelledby="marker-log-title"></ol></div><div id="marker-photos-field" class="place-photos-field"><span id="marker-photos-title">${t("Photos")}</span><ul id="marker-photo-list" class="photo-thumbs" aria-labelledby="marker-photos-title"><li><button type="button" id="marker-add-photos" class="photo-add" aria-label="${t("Add photos")}" title="${t("Add photos")}">${icons.plus}</button></li></ul></div><input type="file" id="marker-photo-input" accept="image/*" multiple hidden><div class="dialog-actions"><button type="button" id="marker-delete" class="quiet danger" hidden>${icons.trash}<span>${t("Delete")}</span></button><button type="button" id="marker-move" class="quiet" hidden>${icons.move}<span>${t("Move")}</span></button><button type="button" id="route-points" class="quiet" hidden>${icons.route}<span>${t("Edit points")}</span></button></div><div class="place-save"><button type="submit" id="marker-save" class="primary">${icons.check}<span>${t("Save")}</span></button></div></form>
</dialog>
<dialog id="kind-dialog" class="kind-dialog" aria-labelledby="kind-title">${dialogHeader("kind-title", t("Icon and type"), icons.pin, "kind-close")}<div class="kind-picker" role="radiogroup" aria-labelledby="kind-title">${kindPicks}</div></dialog>
<dialog id="photo-viewer" class="photo-viewer" aria-label="${t("Photos")}"><div class="photo-viewer-stage"><div class="photo-viewer-track"></div></div><button type="button" id="photo-viewer-close" class="dialog-close" aria-label="${t("Close")}" title="${t("Close")}">${icons.close}</button></dialog>
<dialog id="entry-dialog" class="entry-dialog" aria-labelledby="entry-title"><form id="entry-form">${dialogHeader("entry-title", t("Journal entry"), icons.log, "entry-cancel")}<label>${t("Date")}<input id="entry-date" type="date" required></label><label>${t("Note")}<textarea id="entry-text" required maxlength="2000" rows="3"></textarea></label><div class="dialog-actions"><button type="submit" id="entry-add" class="primary">${icons.check}<span>${t("Add")}</span></button></div></form></dialog>
<dialog id="scale-ask-dialog" class="measure-dialog" aria-labelledby="scale-ask-title">${dialogHeader("scale-ask-title", t("Set the map scale?"), icons.scale, "scale-ask-close")}<p>${t("Distances need the map’s scale. Tap both ends of a known length, like the scale bar, then enter that length.")}</p><div class="dialog-actions"><button type="button" id="scale-ask-start" class="primary">${icons.scale}<span>${t("Set scale")}</span></button><button type="button" id="scale-ask-later" class="quiet">${t("Not now")}</button></div></dialog>
<dialog id="scale-dialog" class="measure-dialog" aria-labelledby="scale-title"><form id="scale-form">${dialogHeader("scale-title", t("Distance between the points"), icons.scale, "scale-cancel")}<label>${t("Metres")}<input id="scale-metres" type="number" inputmode="decimal" min="0.1" max="100000" step="any" required enterkeyhint="done"></label><div class="dialog-actions"><button type="submit" id="scale-save" class="primary">${icons.check}<span>${t("Save")}</span></button></div></form></dialog>
<dialog id="name-dialog" aria-labelledby="name-title"><form id="name-form">${dialogHeader("name-title", "", icons.edit, "name-cancel")}<label>${t("Name")}<input id="name-input" required maxlength="100" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></label><div class="dialog-actions"><button type="submit" class="primary">${icons.check}<span>${t("Save")}</span></button></div></form></dialog>`;
