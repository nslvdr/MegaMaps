import { PLAN_DARK, planMarkup } from "../example/plan";
import { locale, plural, t } from "../i18n";
import { BRIGHTNESS_LEVELS, DEFAULT_DIMMING, brightnessPercent, markerKinds, placeColor, routeColors } from "../viewer/navigation";
import { formatDistance, formatWalk } from "../viewer/measure";
import { formatBytes, lastUsed, updatedAgo } from "./format";
import { icons } from "./icons";
import { homeMarkup, importDialogsMarkup, mapDialogsMarkup } from "./library-markup";
import { placeIcon } from "./place-icon";
import { settingsMarkup } from "./settings-page";
import { sharingMarkup } from "./sharing";
import { gardien, places, routes, searchText, tourSearch, TYPING } from "./tour-map";
import { viewerMarkup } from "./viewer-markup";

// The tutorials' phone runs the app's own screens: their markup, copied with
// ids moved to data-id (and input names prefixed) so nothing clashes with the
// real ones, and filled the way the app fills them for each moment.
const copy = (markup: string) => markup.replace(/ id="/g, ' data-id="').replace(/ name="/g, ' name="tour-');

const MAP_NAME = "Val Moulin";
const TEAMMATE = "Lucie";
const DAY = 86_400_000;
const now = Date.now();
const mapBytes = { image: 18_400_000, tiles: 24_100_000 };
// The library's thumbnail: the example map's overview, darkened like the app's.
const thumbnail = `<img src="data:image/svg+xml,${encodeURIComponent(planMarkup(240, "300 250 640 640"))}" alt="" style="filter:${PLAN_DARK}">`;

// The tutorials measure 38 m.
const MEASURED = 38;
/** The query being typed out, a letter at a time. */
let typing: ReturnType<typeof setTimeout> | undefined;

const mapCard = `<article class="map-card" data-id="tour-map-card"><button class="map-open"><div class="thumbnail">${thumbnail}</div><div class="map-details"><h3>${MAP_NAME}</h3><p class="map-saved"><span class="saved-places">${icons.pin}2</span></p><p class="map-meta"><span>${lastUsed({ created: now - 9 * DAY, opened: now - 2 * DAY }, now)}</span><span class="map-size">${icons.storage}${formatBytes(mapBytes.image + mapBytes.tiles)}</span></p></div></button><button class="map-more">${icons.more}</button></article>`;

// The ⋯ menu, as showActionSheet builds it.
const actionItem = (icon: string, label: string, id = "") =>
  `<button type="button" class="action-sheet-item"${id && ` data-id="${id}"`}>${icon}<span>${label}</span></button>`;
const actionSheet = `<dialog class="action-sheet" data-id="tour-actions"><div class="action-sheet-body"><div class="dialog-header"><span class="action-sheet-icon">${thumbnail}</span><div class="action-sheet-title"><h2>${MAP_NAME}</h2><small>${t("Image {size}", { size: formatBytes(mapBytes.image) })} · ${t("Tiles {size}", { size: formatBytes(mapBytes.tiles) })}</small></div><button type="button" class="dialog-close">${icons.close}</button></div><div class="action-sheet-list">${actionItem(icons.share, t("Share"))}${actionItem(icons.edit, t("Rename"))}${actionItem(icons.tools, t("Advanced settings"), "tour-advanced")}</div><button type="button" class="danger">${icons.trash}<span>${t("Delete")}</span></button></div></dialog>`;

// A finger: a big hand whose fingertip is the touch, a red dot while it
// presses and a red ring spreading from each press.
const tourFinger = `<span class="tour-finger"><span class="tour-ripple"></span><span class="tour-touch"></span><span class="tour-hand">${icons.followTap}${icons.followTap}</span></span>`;

/** The phone's screen, its map drawn by the app's viewer (see tour-map). */
export const tourScreenMarkup = `<div class="tour-screen" id="tour-screen" data-show="" inert>
<section class="viewer" data-id="viewer">${copy(viewerMarkup)}</section>
${copy(homeMarkup()).replace('<div class="map-list" data-id="map-grid"></div>', `<div class="map-list" data-id="map-grid">${mapCard}</div>`)}
${copy(settingsMarkup)}
${copy(importDialogsMarkup + mapDialogsMarkup + sharingMarkup)}${actionSheet}
<div class="tour-scrim"></div>
${tourFinger}${tourFinger}
</div>`;

// What each tutorial taps, in the copied screens.
const taps: Record<string, string> = {
  view: "open-display", rotation: "open-rotation", measure: "open-measure", saved: "open-saved", add: "open-add",
  search: "open-search", count: "search-count", route: "add-route", done: "tool-done", "scale-start": "scale-ask-start",
  "scale-save": "scale-save", edit: "marker-edit", move: "marker-move", save: "marker-save", share: "share-saved",
  settings: "settings-open", import: "import-open", "new-map": "import-image", "shared-file": "import-share",
  advanced: "tour-advanced", rerun: "rerun-ocr", detect: "ocr-offer-start", send: "share-send", receive: "receive-import",
  backup: "settings-backup", restore: "settings-restore",
};
const tapSelectors: Record<string, string> = {
  "open-map": ".map-open",
  more: ".map-more",
  manual: 'label:has(> [data-id="rotation-free"])',
  dark: 'label:has(> [data-id="dark-map"])',
  dim: `label:has(> [data-id="brightness-${brightnessPercent(BRIGHTNESS_LEVELS.at(-1)!)}"])`,
};
/** What a tutorial's `tap` touches on the screen, if it shows. */
export const tapTarget = (screen: HTMLElement, tap: string) =>
  [...screen.querySelectorAll<HTMLElement>(tapSelectors[tap] ?? `[data-id="${taps[tap]}"]`)].find((element) => !element.closest("[hidden]"));

const day = (time: number, timeStyle?: "short") => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle }).format(time);
const toastTexts: Record<string, string> = {
  "chatiere-saved": t("{name} saved", { name: "Chatière" }),
  "route-saved": t("{name} saved · {points}", { name: routes[1]!.name, points: plural(routes[1]!.points.length, "point") }),
  "trail-added": t("Trail point added"),
  "scale-set": t("Scale set"),
};
const dialogs: Record<string, string> = {
  import: "import-dialog", progress: "progress-dialog", ocr: "ocr-offer-dialog", actions: "tour-actions",
  advanced: "advanced-map-dialog", share: "share-dialog", receive: "receive-dialog", "scale-ask": "scale-ask-dialog",
  "scale-length": "scale-dialog",
};

/**
 * Sets the screens up for `show`, the space-separated names of what is on
 * screen, the way the app would have them. A step that starts somewhere new
 * `jump`s there; one the app answers moves there as the app does. While a
 * line is tapped out, `drawn` says how many of its points are down.
 */
export function showScene(screen: HTMLElement, show: string, jump = false, drawn?: number) {
  const shown = new Set(show.split(" "));
  const has = (name: string) => shown.has(name);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => screen.querySelector<T>(`[data-id="${id}"]`)!;
  const text = (id: string, value: string) => ($(id).textContent = value);
  const hide = (id: string, hidden: boolean) => ($(id).hidden = hidden);
  const check = (id: string, checked: boolean) => ($<HTMLInputElement>(id).checked = checked);

  const page = has("library") ? "home" : has("settings") ? "settings" : "viewer";
  for (const id of ["viewer", "home", "settings"]) hide(id, id !== page);
  for (const [name, id] of Object.entries(dialogs)) $(id).toggleAttribute("open", has(name));

  // The library, with one map once it's imported.
  const card = has("map-card");
  text("map-count", card ? "1" : "0");
  hide("tour-map-card", !card);
  hide("empty", card);
  const built = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  text("app-updated-at", `${pad(built.getDate())}/${pad(built.getMonth() + 1)} ${pad(built.getHours())}:${pad(built.getMinutes())}`);
  // Underground, as it's used.
  const internet = $("internet-status");
  internet.dataset.state = "idle";
  internet.querySelector(".footer-icon")!.innerHTML = icons.noInternet;
  internet.querySelector("strong")!.textContent = t("Offline");
  $("offline-availability").dataset.state = "available";
  text("offline-availability", t("Offline ready"));
  text("import-name", "val-moulin.jpg");
  text("progress-percent", "64%");
  text("ocr-offer-title", t("Search this map’s text?"));
  text("ocr-offer-body", t("Text detection reads the labels printed on the map so search can find them. It runs on this device and can take a while on large maps."));
  text("advanced-map-name", MAP_NAME);
  text("ocr-status", `${plural(46, "detected label")}\n${t("Last scanned {date}", { date: day(now - DAY, "short") })}`);

  // Settings, at Your data.
  text("settings-backup-status", [plural(1, "map"), plural(2, "place"), plural(1, "route"), formatBytes(43_100_000)].join(" · "));
  text("settings-storage-status", `${formatBytes(mapBytes.image + mapBytes.tiles)} · ${t("Protected")}`);
  text("backup-note", has("backed-up")
    ? t("Last backup {date}. Keep it in Files or on another device.", { date: day(now) })
    : t("Your maps live only on this device. Keep a backup in Files or on another device."));
  if (page === "settings") {
    const settings = $("settings");
    const data = [...settings.querySelectorAll<HTMLElement>(".settings-heading")].find((heading) => heading.textContent === t("Your data"));
    settings.scrollTo?.({ top: (data?.offsetTop ?? 0) - 20, behavior: jump ? "instant" : "smooth" });
  }

  // Sharing, from the map and into it.
  text("share-map-name", MAP_NAME);
  hide("share-loading", true);
  hide("share-content", false);
  text("share-places-count", t("All {count}", { count: 2 }));
  text("share-routes-count", t("None saved"));
  $("share-size").innerHTML = `<span>${t("Annotations only")}</span><b>${formatBytes(6_200)}</b>`;
  $<HTMLButtonElement>("share-send").disabled = false;
  text("receive-summary", `${MAP_NAME}\n${t("Shared by {name}", { name: TEAMMATE })}\n${plural(1, "place")} · ${plural(1, "route")} · ${t("Annotations only")}`);
  hide("receive-loading", true);
  hide("receive-content", false);
  hide("receive-mode-field", false);
  const destination = (icon: string, className: string, title: string, detail: string, match = false) =>
    `<label class="share-row"><span class="${className}">${icon}</span><span class="share-row-label">${title}<small${match ? ' class="receive-match"' : ""}>${detail}</small></span><input type="radio" name="tour-receive-destination"${match ? " checked" : ""}></label>`;
  $("receive-destinations").innerHTML = destination(icons.map, "receive-thumbnail", MAP_NAME, t("Same map"), true)
    + destination(icons.plus, "receive-thumbnail receive-new", t("New map"), t("Needs the original map image"));
  text("receive-note", t("Keeps your {places} and {routes} and adds the new ones. Places you already have only gain new history entries.", { places: plural(2, "place"), routes: plural(0, "route") }));
  $("receive-import").innerHTML = `${icons.merge}<span>${t("Merge into {name}", { name: MAP_NAME })}</span>`;
  $<HTMLButtonElement>("receive-import").disabled = false;

  // The viewer: one panel at most, or one tool.
  const viewer = $("viewer");
  const sheet = has("view") ? "display" : has("rotation") ? "rotation" : has("add") ? "add" : has("saved") ? "saved" : undefined;
  const manual = has("manual");
  const rotationIcon = manual ? icons.freeRotation : icons.rotationLock;
  hide("sheet", !sheet);
  $("sheet").dataset.panel = sheet ?? "";
  hide("sheet-dismiss", !sheet);
  hide("share-saved", sheet !== "saved");
  hide("reset-rotation", sheet !== "rotation");
  $("sheet-title-icon").innerHTML = sheet === "display" ? icons.sun : sheet === "rotation" ? rotationIcon : sheet === "add" ? icons.add : icons.saved;
  for (const name of ["display", "rotation", "trail", "saved", "add"]) {
    hide(`sheet-${name}`, name !== sheet);
    $(`open-${name}`).setAttribute("aria-expanded", String(name === sheet));
  }
  text("sheet-title", sheet ? $(`sheet-${sheet}`).dataset.title ?? "" : "");

  $("open-rotation").innerHTML = rotationIcon;
  check("rotation-locked", !manual);
  check("rotation-free", manual);
  hide("rotation-help", true);

  const placesShown = places.filter((place) => !place.when || has(place.when));
  const routesShown = routes.filter((route) => has(route.when));
  check("dark-map", !has("paper"));
  text("dark-status", has("paper") ? t("Off: original colors") : t("Colors inverted on pure black"));
  check(`brightness-${brightnessPercent(has("dim") ? BRIGHTNESS_LEVELS.at(-1)! : DEFAULT_DIMMING)}`, true);
  for (const layer of ["routes", "places", "labels"]) check(`layer-${layer}`, true);
  text("layer-routes-count", String(routesShown.length));
  text("layer-places-count", String(placesShown.length));

  // Saved lists, built like the app's rows.
  const row = (icon: string, label: string, detail = "") =>
    `<li class="navigation-row"><div class="row-main"><button class="navigation-jump"><i class="row-icon">${icon}</i><span class="row-text"><strong>${label}</strong>${detail && `<small class="row-detail">${detail}</small>`}</span></button><button class="row-more">${icons.more}</button></div></li>`;
  text("saved-routes-count", String(routesShown.length));
  text("saved-places-count", String(placesShown.length));
  hide("routes-order", routesShown.length < 2);
  hide("places-order", placesShown.length < 2);
  $("route-list").innerHTML = sheet === "saved"
    ? routesShown.map((route, i) => row(icons.route.replace("<svg ", `<svg style="color:${routeColors[i % routeColors.length]}" `), route.name, plural(route.points.length, "point"))).join("") : "";
  $("marker-list").innerHTML = sheet === "saved"
    ? placesShown.map((place) => row(placeIcon(place.kind), place.label, place.description)).join("") : "";

  // A tool swaps the pill for its card.
  const tool = has("route-tool") ? "route" : has("scale-tool") ? "scale" : has("measure-tool") ? "measure" : has("move-tool") ? "move" : undefined;
  const line = tool === "route" ? has("route-drawing") && routes[1]!.points.length : (tool === "scale" ? has("scale") : tool === "measure" && has("measure")) && 2;
  const points = Math.min(drawn ?? Infinity, line || 0);
  const measuring = tool === "measure" || tool === "scale";
  viewer.dataset.tool = tool ?? "browse";
  for (const name of ["display", "rotation", "trail", "saved", "add"]) $<HTMLButtonElement>(`open-${name}`).disabled = !!tool;
  $<HTMLButtonElement>("open-measure").disabled = !!tool && !measuring;
  $("open-measure").setAttribute("aria-pressed", String(measuring));
  $<HTMLInputElement>("map-search").disabled = !!tool;
  hide("dock", !!tool);
  hide("tool-bar", !tool);
  const [icon, title, hint] = tool === "route"
    ? [icons.route, routes[1]!.name, points ? t("{points} · Tap to add, drag to adjust", { points: plural(points, "point") }) : t("Tap where the route starts")]
    : tool === "scale"
      ? [icons.scale, t("Set scale"), points ? t("Drag the ends to adjust, then tap Next") : t("Tap one end of the scale bar or of a known length")]
      : tool === "measure"
        ? [icons.measure, t("Measure"), points > 1 ? t("~{time} on foot · Tap to add, drag to adjust", { time: formatWalk(MEASURED) }) : t("Tap where to start measuring")]
        : [icons.move, gardien.label, t("Drag the pin, or tap where it goes")];
  $("tool-icon").innerHTML = icon;
  text("tool-title", title);
  text("tool-message", hint);
  text("tool-total", tool === "measure" && points > 1 ? formatDistance(MEASURED) : "");
  hide("tool-total", !(tool === "measure" && points > 1));
  hide("tool-rename", tool !== "route" && tool !== "measure");
  hide("route-undo", tool !== "route" && !measuring);
  const done = $<HTMLButtonElement>("tool-done");
  done.hidden = tool === "measure";
  done.innerHTML = tool === "scale" ? `${icons.next}<span>${t("Next")}</span>` : `${icons.check}<span>${t("Done")}</span>`;
  done.disabled = (tool === "route" || tool === "scale") && points < 2;

  // Passing messages, and text detection's progress.
  const toast = Object.keys(toastTexts).find(has);
  hide("toast-bar", !toast);
  hide("toast", !toast);
  $("toast-bar").dataset.tone = "done";
  $("toast-icon").innerHTML = icons.check;
  text("toast", toast ? toastTexts[toast]! : "");
  hide("toast-undo", toast !== "trail-added");
  hide("ocr-progress", !has("ocr-toast"));
  text("ocr-percent", "64%");

  // Search, typed in the pill letter by letter (a query that goes on from
  // what's there types only the rest); its count shows once it's typed out.
  const query = searchText(show);
  const search = $<HTMLInputElement>("map-search");
  const count = $("search-count");
  search.setAttribute("aria-expanded", String(!!query));
  hide("search-close", !query);
  const matches = has("count") ? tourSearch(query).length : 0;
  count.innerHTML = matches ? `${has("next") ? `2 / ${matches}` : plural(matches, "match")}${icons.next}` : "";
  clearTimeout(typing);
  const from = jump || !query ? query.length : query.startsWith(search.value) ? search.value.length : 0;
  const type = (letters: number) => {
    search.value = query.slice(0, letters);
    search.scrollLeft = search.scrollWidth;
    if (letters < query.length) {
      count.hidden = true;
      typing = setTimeout(() => type(letters + 1), TYPING / (query.length - from));
      return;
    }
    const appearing = count.hidden && !!matches && !jump;
    count.hidden = !matches;
    if (appearing) count.animate?.([{ opacity: 0, transform: "translateY(-6px)" }, {}], { duration: 200, easing: "ease-out" });
  };
  type(from);

  // The place card: reading first, editing behind Edit.
  const placeCard = $("marker-dialog");
  const mode = has("place") ? "view" : has("edit") || has("new-place") ? "edit" : undefined;
  const place = has("new-place") ? places[1]! : gardien;
  placeCard.toggleAttribute("open", !!mode);
  placeCard.dataset.mode = mode ?? "view";
  placeCard.style.setProperty("--c", placeColor({ kind: place.kind }));
  $("marker-dialog-title-icon").innerHTML = placeIcon(place.kind);
  text("marker-dialog-title", mode === "view" ? place.label : has("new-place") ? t("New place") : t("Edit place"));
  hide("marker-form", mode !== "edit");
  hide("marker-details", mode !== "view");
  hide("marker-edit", mode !== "view");
  hide("marker-add-entry", mode !== "view");
  hide("marker-detail-updated", mode !== "view");
  hide("marker-detail-log", true);
  text("marker-detail-updated", updatedAgo(now - 3 * DAY, now));
  text("marker-detail-description", place.description ?? "");
  $("marker-kind-current").innerHTML = `${placeIcon(place.kind)}<span>${markerKinds[place.kind].label}</span>`;
  $<HTMLInputElement>("marker-label").value = place.label;
  $<HTMLTextAreaElement>("marker-description").value = place.description ?? "";
  hide("marker-delete", has("new-place"));
  hide("marker-move", has("new-place"));
  hide("route-points", true);
  hide("marker-water", true);
  hide("marker-danger", true);

  $<HTMLInputElement>("scale-metres").value = "20";
  $<HTMLButtonElement>("scale-save").disabled = false;
}
