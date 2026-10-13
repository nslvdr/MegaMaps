import { dialogHeader, showDialog } from "./ui/dialog";
import "./style.css";
import { tileKey, type MapRecord } from "./types";
import { listMaps, markOpened, renameMap } from "./storage/database";
import { payloadStore, deleteStoredMap } from "./storage/payloads";
import { importMap } from "./processing/import";
import { Viewer } from "./viewer/viewer";
import { registerOfflineShell } from "./pwa";
import { findAppUpdate, installAppUpdate } from "./app-update";
import { icons } from "./ui/icons";
import { displayName, formatBytes, lastUsed, plural } from "./ui/format";
import { viewerMarkup } from "./ui/viewer-markup";
import { ViewerControls } from "./ui/viewer-controls";
import { loadNavigation, lastMap, setLastMap } from "./storage/navigation";
import { prunePhotos } from "./storage/photos";
import { darkMode, measureTone } from "./viewer/appearance";
import { initLibraryFooter, libraryFooterMarkup } from "./ui/library-footer";
import { initKeyboardInset } from "./ui/keyboard-inset";
import { lockPageZoom } from "./ui/page-zoom";
import { loadOcr } from "./storage/ocr";
import { needsOcr, type OcrIndex } from "./ocr/index";
import { detectMapText } from "./ocr/detect";
import { initMapRename, mapRenameMarkup } from "./ui/map-rename";
import { initMapMenu } from "./ui/map-menu";
import { initSharing, sharingMarkup } from "./ui/sharing";
import { initUpdateDialog, updateDialogMarkup } from "./ui/update-dialog";
import { importAnnotations, importNewCopy } from "./sharing/storage";
import { isShareFile } from "./sharing/format";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="home" id="home">
    <div class="top-edge" aria-hidden="true"></div>
    <header class="header"><div class="library-brand"><img class="library-logo" src="/icons/icon.svg" alt="" width="48" height="48" draggable="false"><h1>Mega Maps</h1></div><button class="update-app" id="update-app">${icons.rotateRight}<span>Update app</span></button></header>
    <div class="library-actions"><button class="library-action import-trigger" id="import-open">${icons.plus}<span>Import</span></button></div>
    <section class="library" aria-labelledby="library-title"><div class="section-heading"><h2 id="library-title">Your maps <span id="map-count">0</span></h2></div><div class="map-list" id="map-grid"></div><div class="empty" id="empty" hidden><span class="empty-icon">${icons.map}</span><h3>Your next route starts here</h3><p>Import a JPEG, PNG or WebP map, or a .megamap file from a friend.<br>Keep it with you, even offline.</p><p class="empty-drop">You can also drop or paste one here.</p></div></section>
    ${libraryFooterMarkup}
  </main>
  <section id="viewer" class="viewer" aria-label="Map viewer" hidden>${viewerMarkup}</section>
  <input type="file" id="file-input" hidden>
  <dialog id="import-dialog" aria-labelledby="import-title">${dialogHeader("import-title", "Import", icons.download, "import-cancel")}<p>What would you like to add?</p><div class="share-summary"><button class="share-row" id="import-image"><span class="share-row-icon share-image">${icons.map}</span><span class="share-row-label">New map<small>JPEG, PNG or WebP image</small></span>${icons.arrow}</button><button class="share-row" id="import-share"><span class="share-row-icon share-file">${icons.download}</span><span class="share-row-label">Shared file<small>.megamap with places and routes</small></span>${icons.arrow}</button></div></dialog>
  <dialog id="progress-dialog" aria-labelledby="progress-title">${dialogHeader("progress-title", "Preparing map", icons.map, "cancel-import", "Cancel import")}<p id="import-name"></p><div class="progress-track" id="progress-track" role="progressbar" aria-labelledby="progress-message" aria-valuemin="0" aria-valuemax="100"><div id="progress-fill"></div></div><div class="progress-info"><span id="progress-message">Reading image…</span><span id="progress-percent">0%</span></div><p class="dialog-note" id="progress-note">Keep Mega Maps open while your map is prepared.</p></dialog>
  <dialog id="message-dialog" aria-labelledby="message-title" aria-describedby="message-body">${dialogHeader("message-title", "", icons.sparkle, "message-dismiss")}<p id="message-body"></p><button class="primary" id="message-close">${icons.check}<span>Got it</span></button></dialog>
  <dialog id="delete-dialog" aria-labelledby="delete-title">${dialogHeader("delete-title", "Delete this map?", icons.trash, "delete-cancel")}<p id="delete-name" class="delete-map"></p><p class="dialog-note" id="delete-note"></p><div class="dialog-actions"><button class="danger" id="delete-confirm">${icons.trash}<span>Delete map</span></button></div></dialog>
  ${mapRenameMarkup}
  ${sharingMarkup}
  ${updateDialogMarkup}
  <dialog id="advanced-map-dialog" aria-labelledby="advanced-map-title">${dialogHeader("advanced-map-title", "Advanced settings", icons.tools, "advanced-map-close")}<p id="advanced-map-name"></p><h3>Text detection</h3><p id="ocr-status" role="status" aria-live="polite"></p><p class="dialog-note">Detect labels in all directions for map search. Everything stays on this device. Large maps can take a while; keep the app open.</p><div class="map-options"><button class="primary" id="rerun-ocr">${icons.search}<span>Rerun text detection</span></button><button class="secondary" id="stop-ocr" hidden>${icons.close}<span>Stop detection</span></button></div></dialog>
`;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const home = element("home"),
  viewerSection = element("viewer"),
  grid = element("map-grid");
const fileInput = element<HTMLInputElement>("file-input");
const progressDialog = element<HTMLDialogElement>("progress-dialog");
const messageDialog = element<HTMLDialogElement>("message-dialog");
const deleteDialog = element<HTMLDialogElement>("delete-dialog");
const advancedDialog = element<HTMLDialogElement>("advanced-map-dialog");
const mapMenu = initMapMenu();
let selectedMap: MapRecord | undefined;
let ocrJob:
  | {
      mapId: string;
      controller: AbortController;
      message: string;
      done: Promise<void>;
    }
  | undefined;
const ocrErrors = new Map<string, string>();
const refreshFooter = initLibraryFooter(home);
let controls: ViewerControls | undefined;
let pendingViewSave = Promise.resolve();
let openVersion = 0;
let viewer: Viewer | undefined,
  currentMap: MapRecord | undefined,
  maps: MapRecord[] = [];
let importing: AbortController | undefined,
  deleting: MapRecord | undefined,
  renderVersion = 0;
// Library previews by map id. A map's tiles never change, so returning home
// reuses them instead of reading storage and flashing placeholders again.
const thumbnails = new Map<string, string>();
// A map shown dark is previewed dark too, the way the viewer tones it, rather
// than as the brightest thing on a black screen.
const darkFilters = new Map<string, Promise<string>>();
// The filter each card's preview was last shown with, for the delete dialog.
const shownFilters = new Map<string, string>();
function darkFilter(id: string, url: string) {
  let filter = darkFilters.get(id);
  if (!filter) {
    filter = fetch(url)
      .then((response) => response.blob())
      .then(createImageBitmap)
      .then((bitmap) => {
        const tone = measureTone(bitmap);
        bitmap.close();
        return darkMode(tone).filter;
      })
      .catch(() => "");
    darkFilters.set(id, filter);
  }
  return filter;
}
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("map-viewer-library")
    : undefined;
const openRenameMap = initMapRename(
  element<HTMLDialogElement>("rename-map-dialog"),
  async (id, name) => {
    await mutate(async () => {
      await renameMap(id, name);
      channel?.postMessage("changed");
    });
    await refresh();
  },
);
function showMessage(title: string, message: string) {
  element("message-title").textContent = title;
  element("message-body").textContent = message;
  if (!messageDialog.open) showDialog(messageDialog);
}
const loadedVersion = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? "";
const loadedRelease = new Date(document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content ?? "");
// Ask before downloading; keep the current map/session and wait for durable saves before reloading.
const updates = initUpdateDialog(element<HTMLDialogElement>("update-dialog"), {
  currentRelease: Number.isFinite(loadedRelease.getTime()) ? loadedRelease : undefined,
  find: () => findAppUpdate(loadedVersion),
  install: (report) => mutate(async () => {
    if (importing || ocrJob) throw new Error("Mega Maps started preparing a map. Let it finish, then try again.");
    const installed = await installAppUpdate(loadedVersion, (progress) => report({ step: "download", ...progress }));
    if (!installed) return false;
    report({ step: "save" });
    await pendingViewSave;
    await controls?.prepareForUpdate();
    return true;
  }),
  restart: () => window.location.reload(),
});
const sharing = initSharing(app, {
  maps: listMaps,
  import: async (share, destination) => {
    if (importing || updates.busy) throw new Error("Finish the current operation before importing a share.");
    await pendingViewSave;
    const controller = new AbortController();
    importing = controller;
    element("progress-title").textContent = "Importing shared map";
    element("progress-title-icon").innerHTML = icons.download;
    element("progress-note").textContent = "Keep Mega Maps open while the share is imported.";
    element("cancel-import").setAttribute("aria-label", "Cancel import");
    element("cancel-import").title = "Cancel import";
    element("import-name").textContent = displayName(share.manifest.map.name);
    showProgress(0, "Checking shared map…");
    showDialog(progressDialog);
    try {
      const result = await mutate(async () => {
        if (destination.mapId) {
          controller.signal.throwIfAborted();
          const counts = await importAnnotations(destination.mapId, share.manifest, destination.mode, controller.signal, share.photos);
          const map = (await listMaps()).find((map) => map.id === destination.mapId);
          if (!map) throw new Error("This map is no longer available.");
          return { map, ...counts };
        }
        if (!destination.image) throw new Error("Choose the original map image to create a copy.");
        return importNewCopy(share, destination.image, (progress) =>
          showProgress(progress.fraction * 100, progress.message), controller.signal);
      });
      channel?.postMessage({ type: "annotations", mapId: result.map.id });
      return result;
    } finally {
      progressDialog.close();
      importing = undefined;
    }
  },
  imported: async (result, destination) => {
    await refresh();
    await openMap(result.map);
    if (!destination.mapId) showMessage("Share imported", `${plural(result.added, "item")} added to a new map.`);
    else if (destination.mode === "replace")
      showMessage("Share imported", `${plural(result.removed ?? 0, "item")} removed · ${plural(result.added, "shared item")} added.`);
    else showMessage("Share imported", `${result.added} items added · ${result.skipped} already imported and skipped.\nYour existing annotations and local edits were kept.`);
  },
});

// Flush pending edits before taking the independent export snapshot.
async function shareMap(map: MapRecord, item?: { kind: "marker" | "route"; id: string }) {
  try {
    await pendingViewSave;
    await controls?.prepareForUpdate();
    await sharing.openExport(map, await loadNavigation(map.id), item);
  } catch (error) {
    showMessage("Could not prepare share", error instanceof Error ? error.message : String(error));
  }
}
// An origin-wide lock prevents launch cleanup from racing another tab's import.
async function mutate<T>(work: () => Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request(
      "map-viewer-storage",
      { ifAvailable: true },
      (lock) => {
        if (!lock)
          throw new Error(
            "Mega Maps is preparing a map in another window. Let it finish first.",
          );
        return work();
      },
    );
  return work();
}
const appTitle = document.title;
/** The open map names the tab and the app switcher entry. */
function showTitle() {
  document.title = currentMap ? `${displayName(currentMap.name)} · ${appTitle}` : appTitle;
}
let leavingMap = false;
// Going home returns to the same place in the list, on the map just closed.
let libraryScroll = 0;
// Back closes a panel or tool first, then the map.
window.addEventListener("popstate", (event) => {
  const wanted = (event.state as { map?: string } | null)?.map;
  if (leavingMap) leavingMap = false;
  else if (currentMap && !wanted) {
    if (document.querySelector("dialog:modal") || controls?.escape())
      history.pushState({ map: currentMap.id }, "");
    else closeViewer();
  } else if (!currentMap && wanted) {
    const map = maps.find((map) => map.id === wanted);
    if (map) void openMap(map);
  }
});
function closeViewer() {
  openVersion++;
  const closed = currentMap?.id;
  if (controls) pendingViewSave = controls.dispose();
  controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  currentMap = undefined;
  showTitle();
  void setLastMap(null).catch((error) =>
    showMessage("Could not save home view", String(error)),
  );
  // Drop the map's history entry so Back from home leaves the app as usual.
  if (history.state?.map) {
    leavingMap = true;
    history.back();
  }
  viewerSection.hidden = true;
  home.hidden = false;
  void refreshFooter();
  document.body.classList.remove("viewing");
  void refresh()
    .then(() => {
      // The map just left now leads the list; the library opens at it.
      if (!home.hidden) window.scrollTo(0, maps[0]?.id === closed ? 0 : libraryScroll);
    })
    .catch((error) => showMessage("Storage unavailable", String(error)));
}
async function openMap(map: MapRecord) {
  const version = ++openVersion;
  if (controls) pendingViewSave = controls.dispose();
  controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  if (!home.hidden) libraryScroll = window.scrollY;
  currentMap = map;
  map.opened = Date.now();
  void markOpened(map.id, map.opened).catch(() => {});
  showTitle();
  // An open map gets its own history entry, so the system Back returns home.
  if (history.state?.map) history.replaceState({ map: map.id }, "");
  else history.pushState({ map: map.id }, "");
  viewerSection.hidden = false;
  home.hidden = true;
  document.body.classList.add("viewing");
  element("viewer-error").hidden = true;
  try {
    // Reopening immediately must read the completed save, not the last throttle tick.
    await pendingViewSave;
    if (version !== openVersion) return;
    const state = await loadNavigation(map.id);
    if (version !== openVersion) return;
    void prunePhotos(map.id).catch(() => {});
    controls = new ViewerControls(viewerSection, map, state, (item) => { void shareMap(map, item); });
    viewer = new Viewer(
      element<HTMLCanvasElement>("map-canvas"),
      map,
      () => {}, // No zoom readout: the map is the only thing on screen.
      (message) => {
        element("viewer-error").textContent = message;
        element("viewer-error").hidden = false;
      },
      controls.options(),
    );
    controls.attach(viewer);
    void prepareMapSearch(map, version);
    await setLastMap(map.id);
  } catch (error) {
    if (version === openVersion) {
      closeViewer();
      showMessage("Could not open map", String(error));
    }
  }
}
function confirmDelete(map: MapRecord) {
  deleting = map;
  // The thumbnail shows which map goes, not just its name.
  const thumbnail = thumbnails.get(map.id);
  const img = thumbnail && Object.assign(document.createElement("img"), { src: thumbnail, alt: "", draggable: false });
  if (img) img.style.filter = shownFilters.get(map.id) ?? "";
  // Framed from outside, so a dark preview's filter leaves the border alone.
  const frame = img && Object.assign(document.createElement("span"), { className: "delete-thumb" });
  if (frame && img) frame.append(img);
  element("delete-name").replaceChildren(...(frame ? [frame] : []), displayName(map.name));
  const note = element("delete-note");
  note.textContent = "This removes the map and its saved routes and places from this device.";
  showDialog(deleteDialog);
  // Name what would be lost, so an empty map reads as a light delete.
  void loadNavigation(map.id)
    .then(({ markers, routes }) => {
      if (deleting !== map) return;
      const saved = [
        markers.length && plural(markers.length, "place"),
        routes.length && plural(routes.length, "route"),
      ].filter(Boolean);
      note.textContent = saved.length
        ? `This removes the map and its ${saved.join(" and ")} from this device.`
        : "This removes the map from this device.";
    })
    .catch(() => {});
}
async function refresh() {
  const version = ++renderVersion;
  const records = await listMaps();
  if (version !== renderVersion) return;
  maps = records
    .filter((m) => m.status === "ready")
    .sort((a, b) => (b.opened ?? b.created) - (a.opened ?? a.created));
  if (currentMap && !maps.some((m) => m.id === currentMap!.id)) {
    closeViewer();
    showMessage("Map removed", "This map was removed in another window.");
    return;
  }
  if (currentMap) {
    const updated = maps.find((map) => map.id === currentMap!.id);
    if (updated) {
      Object.assign(currentMap, updated);
      showTitle();
      controls?.refreshMetadata();
      void loadOcr(updated.id)
        .then((index) => {
          if (currentMap?.id === updated.id)
            controls?.updateOcr(
              index,
              ocrJob?.mapId === updated.id
                ? ocrJob.message
                : (ocrErrors.get(updated.id) ?? ""),
            );
        })
        .catch(() => {});
    }
  }
  for (const [id, url] of thumbnails)
    if (!maps.some((map) => map.id === id)) {
      URL.revokeObjectURL(url);
      thumbnails.delete(id);
      darkFilters.delete(id);
      shownFilters.delete(id);
    }
  // Behind an open map the grid is unseen; going home renders it afresh.
  if (home.hidden) return;
  mapMenu.close();
  grid.replaceChildren();
  element("empty").hidden = maps.length > 0;
  element("map-count").textContent = `${maps.length}`;
  // A 0 beside the empty state says nothing it doesn't.
  element("map-count").hidden = !maps.length;
  for (const map of maps) {
    const card = document.createElement("article");
    card.className = "map-card";
    card.dataset.map = map.id;
    card.innerHTML = `<button class="map-open"><div class="thumbnail"><span class="thumbnail-placeholder">${icons.map}</span></div><div class="map-details"><h3></h3><p class="map-saved">\u00a0</p><p class="map-meta"></p></div></button><button class="map-more" aria-haspopup="menu" aria-expanded="false">${icons.more}</button>`;
    card.querySelector("h3")!.textContent = displayName(map.name);
    // What's on a map is what tells two maps apart; when it was last used
    // (which is also the list's order) and its size follow. On narrow
    // screens it breaks between the two parts, not inside one.
    card.querySelector(".map-meta")!.append(
      ...[`${lastUsed(map)} · `, formatBytes(map.bytes)]
        .map((part) => Object.assign(document.createElement("span"), { textContent: part })),
    );
    const saved = card.querySelector(".map-saved")!;
    // Leaving a map may still be writing its last edits.
    const navigation = pendingViewSave
      .catch(() => {})
      .then(() => loadNavigation(map.id));
    void navigation
      .then(({ markers, routes }) => {
        if (version !== renderVersion) return;
        const items = [
          markers.length && plural(markers.length, "place"),
          routes.length && plural(routes.length, "route"),
        ].filter(Boolean);
        saved.textContent = items.join(" · ") || "Nothing saved yet";
        saved.classList.toggle("none", !items.length);
      })
      .catch(() => {});
    const more = card.querySelector<HTMLButtonElement>(".map-more")!;
    const name = displayName(map.name);
    more.title = "Map options";
    more.setAttribute("aria-label", `Options for ${name}`);
    const openButton = card.querySelector<HTMLButtonElement>(".map-open")!;
    openButton.addEventListener("click", () => {
      void openMap(map);
    });
    more.addEventListener("click", () =>
      mapMenu.toggle(more, name, [
        { label: "Share", icon: icons.share, action: () => { void shareMap(map); } },
        { label: "Rename", icon: icons.edit, action: () => openRenameMap(map) },
        {
          label: "Advanced settings",
          icon: icons.tools,
          action: () => {
            selectedMap = map;
            element("ocr-status").textContent = "Checking text detection…";
            showDialog(advancedDialog);
            void renderOcrSettings();
          },
        },
        {
          label: "Delete",
          icon: icons.trash,
          danger: true,
          action: () => confirmDelete(map),
        },
      ]),
    );
    grid.append(card);
    const showThumbnail = async (url: string) => {
      const inverted = await navigation.then((state) => state.inverted, () => false);
      const filter = inverted ? await darkFilter(map.id, url) : "";
      if (version !== renderVersion) return;
      shownFilters.set(map.id, filter);
      const img = new Image();
      img.style.filter = filter;
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      // A dragged thumbnail would carry its image as a file, and dropped back
      // on the library it would import as a new map.
      img.draggable = false;
      card.querySelector(".thumbnail")!.prepend(img);
    };
    const cached = thumbnails.get(map.id);
    if (cached) {
      void showThumbnail(cached);
      continue;
    }
    void payloadStore(map.backend)
      .get(map.id, tileKey(map.levels.length - 1, 0, 0))
      .then((blob) => {
        // An overlapping refresh may have loaded it first.
        let url = thumbnails.get(map.id);
        if (!url) {
          url = URL.createObjectURL(blob);
          thumbnails.set(map.id, url);
        }
        if (version === renderVersion) void showThumbnail(url);
      })
      .catch(() => {
        card.querySelector(".thumbnail-placeholder")!.textContent =
          "Preview unavailable";
      });
  }
}
const importDialog = element<HTMLDialogElement>("import-dialog");
element("import-open").addEventListener("click", () => showDialog(importDialog));
// On first run the whole empty card is a target too; Import stays the labelled control.
element("empty").addEventListener("click", () => element("import-open").click());
element("import-cancel").addEventListener("click", () => importDialog.close());
// Each row only narrows the picker; the file's header decides how it is imported.
for (const [id, accept] of [
  ["import-image", "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"],
  ["import-share", ".megamap,application/octet-stream"],
] as const)
  element(id).addEventListener("click", () => {
    importDialog.close();
    fileInput.accept = accept;
    fileInput.click();
  });
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void importFile(file);
});
async function importFile(file: File) {
  if (importing) return;
  if (await isShareFile(file).catch(() => false)) void sharing.openImport(file);
  else importImage(file);
}
// Desktop: a map or .megamap file dropped on the library imports like Import.
// Anywhere else, a dropped file must not replace the app with the raw image.
const carriesFiles = (event: DragEvent) =>
  !!event.dataTransfer?.types.includes("Files");
const canDrop = () =>
  !home.hidden && !importing && !document.querySelector("dialog[open]");
for (const type of ["dragover", "drop"] as const)
  window.addEventListener(type, (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
home.addEventListener("dragover", (event) => {
  if (!carriesFiles(event)) return;
  const accepted = canDrop();
  event.dataTransfer!.dropEffect = accepted ? "copy" : "none";
  home.classList.toggle("dropping", accepted);
});
home.addEventListener("dragleave", (event) => {
  if (!home.contains(event.relatedTarget as Node | null))
    home.classList.remove("dropping");
});
home.addEventListener("drop", (event) => {
  home.classList.remove("dropping");
  const file = event.dataTransfer?.files[0];
  if (file && canDrop()) void importFile(file);
});
// Pasting a copied image or screenshot imports it too.
document.addEventListener("paste", (event) => {
  let file = event.clipboardData?.files[0];
  if (!file || !canDrop()) return;
  event.preventDefault();
  // Screenshots arrive as "image.png"; a dated name tells them apart.
  if (/^image\.\w+$/i.test(file.name)) {
    const date = new Date().toLocaleDateString(undefined, { dateStyle: "medium" });
    file = new File([file], `Pasted map ${date}${file.name.slice(5)}`, { type: file.type });
  }
  void importFile(file);
});
function importImage(file: File) {
  if (importing) return;
  importing = new AbortController();
  const controller = importing;
  element("progress-title").textContent = "Preparing map";
  element("progress-title-icon").innerHTML = icons.map;
  element("progress-note").textContent =
    "Keep Mega Maps open while your map is prepared.";
  element("cancel-import").setAttribute("aria-label", "Cancel import");
  element("cancel-import").title = "Cancel import";
  element("import-name").textContent = file.name;
  showProgress(0, "Reading image metadata…");
  showDialog(progressDialog);
  void mutate(async () => {
    const map = await importMap(
      file,
      (progress) => showProgress(progress.fraction * 80, progress.message),
      controller.signal,
    );
    element("progress-title").textContent = "Detecting map text";
    element("progress-title-icon").innerHTML = icons.search;
    element("progress-note").textContent =
      "Your map is saved. Keep the app open to finish search detection, or stop and do it later.";
    element("cancel-import").setAttribute("aria-label", "Stop detection");
    element("cancel-import").title = "Stop detection";
    try {
      await runOcr(map, controller, (progress) =>
        showProgress(80 + progress.fraction * 20, progress.message));
    } catch (error) {
      if (!controller.signal.aborted)
        showMessage(
          "Map saved; text detection failed",
          `${String(error)} You can retry in the map’s Advanced settings.`,
        );
    }
    channel?.postMessage("changed");
  })
    .then(async () => {
      await refresh();
    })
    .catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        showMessage(
          "Couldn’t import this map",
          error instanceof Error ? error.message : String(error),
        );
    })
    .finally(() => {
      progressDialog.close();
      importing = undefined;
    });
}
// The tab title carries the percentage too, for imports left in the background.
function showProgress(percent: number, message: string) {
  const rounded = Math.round(percent);
  element("progress-fill").style.width = `${percent}%`;
  element("progress-percent").textContent = `${rounded}%`;
  element("progress-track").setAttribute("aria-valuenow", String(rounded));
  element("progress-message").textContent = message;
  document.title = `${rounded}% · ${appTitle}`;
}
progressDialog.addEventListener("close", showTitle);
element("cancel-import").addEventListener("click", () => {
  importing?.abort();
});
progressDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  importing?.abort();
});
for (const id of ["message-close", "message-dismiss"])
  element(id).addEventListener("click", () => messageDialog.close());
element("update-app").addEventListener("click", () => {
  if (updates.busy) updates.open();
  else if (importing || ocrJob)
    updates.explain("Finish the current task first", "Mega Maps is preparing a map. Let it finish, or stop it, then check for updates again.");
  else if (!import.meta.env.PROD || !("serviceWorker" in navigator))
    updates.explain("Updates aren’t available here", "App updates work in the installed app or on the live HTTPS site.");
  else updates.open();
});
element("delete-cancel").addEventListener("click", () => deleteDialog.close());
element("delete-confirm").addEventListener("click", () => {
  const map = deleting;
  if (!map) return;
  deleteDialog.close();
  deleting = undefined;
  const job = ocrJob?.mapId === map.id ? ocrJob : undefined;
  job?.controller.abort();
  void (job?.done ?? Promise.resolve())
    .then(() =>
      mutate(async () => {
        await deleteStoredMap(map);
        channel?.postMessage("changed");
      }),
    )
    .then(() => refresh())
    .catch((error) => showMessage("Couldn’t delete map", String(error)));
});
element("back").addEventListener("click", closeViewer);
channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "annotations" &&
      "mapId" in data && data.mapId === currentMap?.id)
    void controls?.refreshImports().catch((error) => showMessage("Could not refresh shared items", String(error)));
  if (!importing)
    void refresh().catch((error) =>
      showMessage("Storage unavailable", String(error)),
    );
});

// OCR shares the storage lock with imports/deletion, and commits only full scans.
async function runOcr(
  map: MapRecord,
  controller: AbortController,
  onProgress: (progress: {
    fraction: number;
    message: string;
  }) => void = () => {},
) {
  if (ocrJob)
    throw new Error(
      "Text detection is already running. Let it finish or stop it first.",
    );
  let previous: OcrIndex | undefined;
  let release = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = {
    mapId: map.id,
    controller,
    message: "Starting local text detection…",
    done,
  };
  ocrJob = job;
  ocrErrors.delete(map.id);
  const update = () => {
    if (currentMap?.id === map.id) controls?.updateOcr(previous, job.message);
    if (selectedMap?.id === map.id) {
      element("ocr-status").textContent = job.message;
      element<HTMLButtonElement>("rerun-ocr").disabled = true;
      element("stop-ocr").hidden = false;
    }
  };
  try {
    previous = await loadOcr(map.id);
    update();
    const index = await detectMapText(
      map,
      (progress) => {
        job.message = progress.message;
        update();
        onProgress(progress);
      },
      controller.signal,
    );
    if (currentMap?.id === map.id) controls?.updateOcr(index);
    channel?.postMessage("changed");
    return index;
  } catch (error) {
    const message = controller.signal.aborted
      ? "Text detection stopped. Rerun it in Advanced settings."
      : "Text detection failed. Rerun it in Advanced settings.";
    ocrErrors.set(map.id, message);
    if (currentMap?.id === map.id) controls?.updateOcr(previous, message);
    throw error;
  } finally {
    ocrJob = undefined;
    release();
    if (selectedMap?.id === map.id) void renderOcrSettings();
    if (currentMap && currentMap.id !== map.id)
      void prepareMapSearch(currentMap, openVersion);
  }
}

// Old libraries need no reimport. Opening a map without an index starts a scan.
async function prepareMapSearch(map: MapRecord, version: number) {
  try {
    const index = await loadOcr(map.id);
    if (version !== openVersion) return;
    controls?.updateOcr(index, ocrJob?.mapId === map.id ? ocrJob.message : "");
    if (!needsOcr(index) || ocrJob?.mapId === map.id) return;
    await mutate(() => runOcr(map, new AbortController()));
  } catch (error) {
    if (version === openVersion && !ocrErrors.has(map.id))
      controls?.updateOcr(
        undefined,
        `${String(error)} Retry in the map’s Advanced settings.`,
      );
  }
}

async function renderOcrSettings() {
  const map = selectedMap;
  if (!map) return;
  const index: OcrIndex | undefined = await loadOcr(map.id).catch(
    () => undefined,
  );
  if (selectedMap?.id !== map.id) return;
  const running = ocrJob?.mapId === map.id;
  element("advanced-map-name").textContent = displayName(map.name);
  element("ocr-status").textContent = running
    ? ocrJob!.message
    : (ocrErrors.get(map.id) ??
      (index
        ? `${plural(index.lines.length, "detected label")}\nLast scanned ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(index.completedAt)}`
        : "Text detection has not run yet."));
  element<HTMLButtonElement>("rerun-ocr").disabled = !!ocrJob || !!importing;
  element("stop-ocr").hidden = !running;
}
element("advanced-map-close").addEventListener("click", () =>
  advancedDialog.close(),
);
element("stop-ocr").addEventListener("click", () => {
  if (ocrJob?.mapId === selectedMap?.id) ocrJob?.controller.abort();
});
element("rerun-ocr").addEventListener("click", () => {
  const map = selectedMap;
  if (!map || ocrJob || importing) return;
  element<HTMLButtonElement>("rerun-ocr").disabled = true;
  void mutate(() => runOcr(map, new AbortController()))
    .catch((error) => {
      if (!ocrErrors.has(map.id))
        showMessage("Couldn’t start text detection", String(error));
    })
    .finally(() => void renderOcrSettings());
});
initKeyboardInset();
lockPageZoom();
void registerOfflineShell().then(refreshFooter);
async function start() {
  await mutate(async () => {
    for (const map of await listMaps())
      if (map.status !== "ready") await deleteStoredMap(map);
  }).catch(() => {}); // Another tab may legitimately be importing; don't touch its files.
  await refresh();
  const resume = await lastMap();
  const map = maps.find((map) => map.id === resume);
  if (map) await openMap(map);
}
void start().catch((error) =>
  showMessage(
    "Local storage unavailable",
    error instanceof Error ? error.message : String(error),
  ),
);
Object.defineProperty(window, "MapViewer", {
  value: {
    diagnostics: () => viewer?.diagnostics() ?? null,
    library: () => maps.map((m) => ({ ...m })),
  },
  configurable: true,
});
