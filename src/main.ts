import { dialogHeader, showDialog } from "./ui/dialog";
import "./style.css";
import { tileKey, type MapRecord } from "./types";
import { listMaps, markOpened, renameMap } from "./storage/database";
import { payloadStore, deleteAllData, deleteStoredMap } from "./storage/payloads";
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
import { initKeyboardInset, initTapAway } from "./ui/keyboard-inset";
import { lockPageZoom } from "./ui/page-zoom";
import { loadOcr } from "./storage/ocr";
import { needsOcr, type OcrIndex } from "./ocr/index";
import { detectMapText } from "./ocr/detect";
import { initMapRename, mapRenameMarkup } from "./ui/map-rename";
import { showActionSheet } from "./ui/action-sheet";
import { initSharing, sharingMarkup } from "./ui/sharing";
import { initUpdateDialog, updateDialogMarkup } from "./ui/update-dialog";
import { eraseDialogMarkup, initSettingsPage, restoreDialogMarkup, settingsMarkup } from "./ui/settings-page";
import { backupDue, isBackupFile, restoreBackup, type Backup } from "./storage/backup";
import { loadSetting } from "./storage/settings";
import { protectStorage, storageProtected } from "./storage/protection";
import { language, locale, t } from "./i18n";
import { preference } from "./preferences";
import { importAnnotations, importNewCopy } from "./sharing/storage";
import { isShareFile } from "./sharing/format";
import { initInstallPage, installMarkup, isInstalled } from "./ui/install-page";
import { startStats, track } from "./stats";

document.documentElement.lang = language;
document.documentElement.dataset.labels = preference("label-size");
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="home" id="home">
    <div class="top-edge" aria-hidden="true"></div>
    <header class="header"><div class="library-brand"><img class="library-logo" src="/icons/icon.svg" alt="" width="48" height="48" draggable="false"><h1>Mega Maps</h1></div><button class="settings-open" id="settings-open">${icons.settings}<span class="update-dot" aria-hidden="true"></span><span>${t("Settings")}</span></button></header>
    <div class="library-actions"><button class="library-action import-trigger" id="import-open">${icons.plus}<span>${t("Import")}</span></button></div>
    <section class="library" aria-labelledby="library-title"><div class="section-heading"><h2 id="library-title">${t("Your maps")} <span id="map-count">0</span></h2></div><div class="map-list" id="map-grid"></div><div class="empty" id="empty" hidden><span class="empty-icon">${icons.map}</span><h3>${t("Your next route starts here")}</h3><p>${t("Import a JPEG, PNG or WebP map, or a .megamap file from a friend.")}<br>${t("Keep it with you, even offline.")}</p><p class="empty-drop">${t("You can also drop or paste one here.")}</p></div></section>
    ${libraryFooterMarkup}
  </main>
  ${settingsMarkup}
  ${installMarkup}
  <section id="viewer" class="viewer" aria-label="${t("Map viewer")}" hidden>${viewerMarkup}</section>
  <input type="file" id="file-input" hidden>
  <dialog id="import-dialog" aria-labelledby="import-title">${dialogHeader("import-title", t("Import"), icons.download, "import-cancel")}<p>${t("What would you like to add?")}</p><div class="share-summary"><button class="share-row" id="import-image"><span class="share-row-icon share-image">${icons.map}</span><span class="share-row-label">${t("New map")}<small>${t("JPEG, PNG or WebP image")}</small></span>${icons.arrow}</button><button class="share-row" id="import-share"><span class="share-row-icon share-file">${icons.download}</span><span class="share-row-label">${t("Shared file")}<small>${t(".megamap with places and routes")}</small></span>${icons.arrow}</button></div></dialog>
  <dialog id="progress-dialog" aria-labelledby="progress-title">${dialogHeader("progress-title", t("Preparing map"), icons.map, "cancel-import", t("Cancel import"))}<p id="import-name"></p><div class="progress-track" id="progress-track" role="progressbar" aria-labelledby="progress-message" aria-valuemin="0" aria-valuemax="100"><div id="progress-fill"></div></div><div class="progress-info"><span id="progress-message">${t("Reading image…")}</span><span id="progress-percent">0%</span></div><p class="dialog-note" id="progress-note">${t("Keep Mega Maps open while your map is prepared.")}</p></dialog>
  <dialog id="message-dialog" aria-labelledby="message-title" aria-describedby="message-body">${dialogHeader("message-title", "", icons.sparkle, "message-dismiss")}<p id="message-body"></p><button class="primary" id="message-close">${icons.check}<span>${t("Got it")}</span></button></dialog>
  <dialog id="delete-dialog" aria-labelledby="delete-title">${dialogHeader("delete-title", t("Delete this map?"), icons.trash, "delete-cancel")}<p id="delete-name" class="delete-map"></p><p class="dialog-note" id="delete-note"></p><div class="dialog-actions"><button class="danger" id="delete-confirm">${icons.trash}<span>${t("Delete map")}</span></button></div></dialog>
  ${mapRenameMarkup}
  ${sharingMarkup}
  ${updateDialogMarkup}
  ${restoreDialogMarkup}
  ${eraseDialogMarkup}
  <dialog id="advanced-map-dialog" aria-labelledby="advanced-map-title">${dialogHeader("advanced-map-title", t("Advanced settings"), icons.tools, "advanced-map-close")}<p id="advanced-map-name"></p><h3>${t("Text detection")}</h3><p id="ocr-status" role="status" aria-live="polite"></p><p class="dialog-note">${t("Detect labels in all directions for map search. Everything stays on this device. Large maps can take a while; keep the app open.")}</p><div class="map-options"><button class="primary" id="rerun-ocr">${icons.search}<span>${t("Rerun text detection")}</span></button><button class="secondary" id="stop-ocr" hidden>${icons.close}<span>${t("Stop detection")}</span></button></div></dialog>
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
let selectedMap: MapRecord | undefined;
let ocrJob:
  | {
      mapId: string;
      controller: AbortController;
      message: string;
      fraction: number;
      done: Promise<void>;
    }
  | undefined;
const ocrErrors = new Map<string, string>();
const settingsPage = element("settings");
const loadedVersion = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? "";
if (import.meta.env.PROD) startStats(loadedVersion);
const loadedRelease = new Date(document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content ?? "");
const canUpdate = import.meta.env.PROD && "serviceWorker" in navigator;
const settings = initSettingsPage(settingsPage, {
  restore: element<HTMLDialogElement>("restore-dialog"),
  erase: element<HTMLDialogElement>("erase-dialog"),
}, {
  release: Number.isFinite(loadedRelease.getTime()) ? loadedRelease : undefined,
  back: () => history.back(),
  checkUpdates: openUpdates,
  restore: (backup) => void restore(backup),
  erase: () => void erase(),
  setLabelSize: (size) => { document.documentElement.dataset.labels = size; },
});
// Versions installed automatically this session, so a failed one waits for a tap instead of retrying.
const autoInstalled = new Set<string>();
// The footer checks quietly while the library shows; Settings mirrors its answer.
// Unless Settings asks first, a found update installs by itself once nothing else is going on.
const refreshFooter = initLibraryFooter(home, canUpdate
  ? async () => {
      if (updates.busy) return true;
      const update = await findAppUpdate(loadedVersion);
      settings.setUpdateReady(Boolean(update));
      if (update && preference("update-install") === "auto" && !autoInstalled.has(update.version)
        && !importing && !ocrJob && !home.hidden && !document.querySelector("dialog[open]")) {
        autoInstalled.add(update.version);
        updates.start(update);
      }
      return Boolean(update);
    }
  : undefined);
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
// Ask before downloading; keep the current map/session and wait for durable saves before reloading.
const updates = initUpdateDialog(element<HTMLDialogElement>("update-dialog"), {
  currentRelease: Number.isFinite(loadedRelease.getTime()) ? loadedRelease : undefined,
  find: () => findAppUpdate(loadedVersion),
  install: (report) => mutate(async () => {
    if (importing || ocrJob) throw new Error(t("Mega Maps started preparing a map. Let it finish, then try again."));
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
    if (importing || updates.busy) throw new Error(t("Finish the current operation before importing a share."));
    await pendingViewSave;
    const controller = new AbortController();
    importing = controller;
    element("progress-title").textContent = t("Importing shared map");
    element("progress-title-icon").innerHTML = icons.download;
    element("progress-note").textContent = t("Keep Mega Maps open while the share is imported.");
    element("import-name").textContent = displayName(share.manifest.map.name);
    showProgress(0, t("Checking shared map…"));
    showDialog(progressDialog);
    try {
      const result = await mutate(async () => {
        if (destination.mapId) {
          controller.signal.throwIfAborted();
          const counts = await importAnnotations(destination.mapId, share.manifest, destination.mode, controller.signal, share.photos, share.ocr);
          const map = (await listMaps()).find((map) => map.id === destination.mapId);
          if (!map) throw new Error(t("This map is no longer available."));
          return { map, ...counts };
        }
        if (!destination.image) throw new Error(t("Choose the original map image to create a copy."));
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
    track("share_imported", { into: destination.mapId ? destination.mode : "new", items: result.added });
    await refresh();
    await openMap(result.map);
    if (!destination.mapId) showMessage(t("Share imported"), t("{items} added to a new map.", { items: plural(result.added, "item") }));
    else if (destination.mode === "replace")
      showMessage(t("Share imported"), t("{removed} removed · {added} added.", { removed: plural(result.removed ?? 0, "item"), added: plural(result.added, "shared item") }));
    else if (result.updated)
      showMessage(t("Share imported"), t("{added} added · {updated} with new history · {skipped} already imported and skipped.\nYour existing annotations and local edits were kept.", { added: plural(result.added, "item"), updated: plural(result.updated, "place"), skipped: result.skipped }));
    else showMessage(t("Share imported"), t("{added} added · {skipped} already imported and skipped.\nYour existing annotations and local edits were kept.", { added: plural(result.added, "item"), skipped: result.skipped }));
  },
});

// Flush pending edits before taking the independent export snapshot.
async function shareMap(map: MapRecord, item?: { kind: "marker" | "route"; id: string }) {
  try {
    await pendingViewSave;
    await controls?.prepareForUpdate();
    await sharing.openExport(map, await loadNavigation(map.id), item);
  } catch (error) {
    showMessage(t("Could not prepare share"), error instanceof Error ? error.message : String(error));
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
            t("Mega Maps is preparing a map in another window. Let it finish first."),
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
// Going home returns to the same place in the list, on the map just closed.
let libraryScroll = 0;
// Back leaves Settings. A map has no history entry: only its Back button
// leaves it, so a stray edge swipe can't.
window.addEventListener("popstate", (event) => {
  const state = event.state as { settings?: boolean } | null;
  if (!settingsPage.hidden && !state?.settings) {
    if (document.querySelector("dialog:modal")) history.pushState({ settings: true }, "");
    else hideSettings();
  } else if (settingsPage.hidden && state?.settings && !currentMap) showSettings();
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
    showMessage(t("Could not save home view"), String(error)),
  );
  viewerSection.hidden = true;
  home.hidden = false;
  void refreshFooter();
  document.body.classList.remove("viewing");
  void refresh()
    .then(() => {
      // The map just left now leads the list; the library opens at it.
      if (!home.hidden) window.scrollTo(0, maps[0]?.id === closed ? 0 : libraryScroll);
    })
    .catch((error) => showMessage(t("Storage unavailable"), String(error)));
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
  viewerSection.hidden = false;
  home.hidden = true;
  document.body.classList.add("viewing");
  try {
    // Reopening immediately must read the completed save, not the last throttle tick.
    await pendingViewSave;
    if (version !== openVersion) return;
    const state = await loadNavigation(map.id);
    if (version !== openVersion) return;
    void prunePhotos(map.id).catch(() => {});
    controls = new ViewerControls(viewerSection, map, state, (item) => { void shareMap(map, item); });
    // A broken map is a big error: say so once, not for every unreadable tile.
    let reported = false;
    viewer = new Viewer(
      element<HTMLCanvasElement>("map-canvas"),
      map,
      () => {}, // No zoom readout: the map is the only thing on screen.
      (message) => {
        if (!reported) showMessage(t("Couldn’t show this map"), message);
        reported = true;
      },
      controls.options(),
    );
    controls.attach(viewer);
    void prepareMapSearch(map, version);
    await setLastMap(map.id);
  } catch (error) {
    if (version === openVersion) {
      closeViewer();
      showMessage(t("Could not open map"), String(error));
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
  note.textContent = t("This removes the map and its saved routes and places from this device.");
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
        ? t("This removes the map and its {saved} from this device.", { saved: saved.join(t(" and ")) })
        : t("This removes the map from this device.");
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
    showMessage(t("Map removed"), t("This map was removed in another window."));
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
          const job = ocrJob?.mapId === updated.id ? ocrJob : undefined;
          if (currentMap?.id === updated.id)
            controls?.updateOcr(
              index,
              job?.message ?? ocrErrors.get(updated.id),
              job?.fraction,
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
  void showBackupReminder();
  grid.replaceChildren();
  element("empty").hidden = maps.length > 0;
  element("map-count").textContent = `${maps.length}`;
  // A 0 beside the empty state says nothing it doesn't.
  element("map-count").hidden = !maps.length;
  for (const map of maps) {
    const card = document.createElement("article");
    card.className = "map-card";
    card.dataset.map = map.id;
    card.innerHTML = `<button class="map-open"><div class="thumbnail"><span class="thumbnail-placeholder">${icons.map}</span></div><div class="map-details"><h3></h3><p class="map-saved">\u00a0</p><p class="map-meta"></p></div></button><button class="map-more" aria-haspopup="dialog">${icons.more}</button>`;
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
        saved.textContent = items.join(" · ") || t("Nothing saved yet");
        saved.classList.toggle("none", !items.length);
      })
      .catch(() => {});
    const more = card.querySelector<HTMLButtonElement>(".map-more")!;
    const name = displayName(map.name);
    more.title = t("Map options");
    more.setAttribute("aria-label", t("Options for {name}", { name }));
    const openButton = card.querySelector<HTMLButtonElement>(".map-open")!;
    openButton.addEventListener("click", () => {
      void openMap(map);
    });
    more.addEventListener("click", () =>
      showActionSheet(document.body, {
        title: name,
        detail: saved.textContent?.trim() || undefined,
        icon: card.querySelector(".thumbnail img")?.cloneNode() ?? icons.map,
        actions: [
          { label: t("Share"), icon: icons.share, action: () => { void shareMap(map); } },
          { label: t("Rename"), icon: icons.edit, action: () => openRenameMap(map) },
          {
            label: t("Advanced settings"),
            icon: icons.tools,
            action: () => {
              selectedMap = map;
              element("ocr-status").textContent = t("Checking text detection…");
              showDialog(advancedDialog);
              void renderOcrSettings();
            },
          },
          {
            label: t("Delete"),
            icon: icons.trash,
            danger: true,
            action: () => confirmDelete(map),
          },
        ],
      }),
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
          t("Preview unavailable");
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
  else if (await isBackupFile(file).catch(() => false))
    void settings.review(file).catch((error) => showMessage(t("Couldn’t read this backup"), String(error instanceof Error ? error.message : error)));
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
    const date = new Date().toLocaleDateString(locale, { dateStyle: "medium" });
    file = new File([file], `${t("Pasted map {date}", { date })}${file.name.slice(5)}`, { type: file.type });
  }
  void importFile(file);
});
function importImage(file: File) {
  if (importing) return;
  importing = new AbortController();
  const controller = importing;
  element("progress-title").textContent = t("Preparing map");
  element("progress-title-icon").innerHTML = icons.map;
  element("progress-note").textContent =
    t("Keep Mega Maps open while your map is prepared.");
  element("import-name").textContent = file.name;
  showProgress(0, t("Reading image metadata…"));
  showDialog(progressDialog);
  const started = Date.now();
  // The map opens once its tiles are saved; text detection follows in the background.
  void mutate(() =>
    importMap(
      file,
      (progress) => showProgress(progress.fraction * 100, progress.message),
      controller.signal,
    ),
  )
    .then(async (map) => {
      track("map_imported", { ok: true, megapixels: Math.round(map.width * map.height / 1e6), seconds: Math.round((Date.now() - started) / 1000) });
      channel?.postMessage("changed");
      progressDialog.close();
      importing = undefined;
      await refresh();
      await openMap(map);
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      track("map_imported", { ok: false });
      showMessage(
        t("Couldn’t import this map"),
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
function openUpdates() {
  if (updates.busy) updates.open();
  else if (importing || ocrJob)
    updates.explain("Finish the current task first", t("Mega Maps is preparing a map. Let it finish, or stop it, then check for updates again."));
  else if (!canUpdate)
    updates.explain(t("Updates aren’t available here"), t("App updates work in the installed app or on the live HTTPS site."));
  else updates.open();
}
element("app-update-status").addEventListener("click", openUpdates);
// Settings is a page of its own: it takes the library's place and Back returns.
function showSettings() {
  libraryScroll = window.scrollY;
  home.hidden = true;
  settingsPage.hidden = false;
  window.scrollTo(0, 0);
  void settings.refresh();
}
function hideSettings() {
  settingsPage.hidden = true;
  home.hidden = false;
  void refreshFooter();
  void showBackupReminder();
  window.scrollTo(0, libraryScroll);
}
element("settings-open").addEventListener("click", () => {
  history.pushState({ settings: true }, "");
  showSettings();
});
// Adds the backup's missing maps, one after another, then shows them in the library.
async function restore(backup: Backup) {
  if (importing || ocrJob || updates.busy)
    return showMessage("Finish the current task first", t("Mega Maps is busy with another map. Let it finish, then restore the backup."));
  const controller = new AbortController();
  importing = controller;
  element("progress-title").textContent = t("Restoring backup");
  element("progress-title-icon").innerHTML = icons.restore;
  element("progress-note").textContent = t("Keep Mega Maps open while your maps are prepared again.");
  element("import-name").textContent = plural(backup.manifest.maps.length, "map");
  showProgress(0, t("Starting…"));
  showDialog(progressDialog);
  try {
    const result = await mutate(() => restoreBackup(backup, (progress) =>
      showProgress(progress.fraction * 100, progress.message), controller.signal));
    progressDialog.close();
    showMessage(t("Backup restored"), t("{maps} added to your library.", { maps: plural(result.added, "map") }));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      showMessage(t("Couldn’t restore the backup"), error instanceof Error ? error.message : String(error));
  } finally {
    progressDialog.close();
    importing = undefined;
    channel?.postMessage("changed");
    await refresh().catch(() => {});
    if (!settingsPage.hidden) void settings.refresh();
  }
}
// Settings' Delete everything, once its three steps are confirmed.
async function erase() {
  if (importing || ocrJob || updates.busy)
    return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
  try {
    await mutate(deleteAllData);
    showMessage(t("Everything deleted"), t("No maps, places or photos are left on this device."));
  } catch (error) {
    showMessage(t("Couldn’t delete everything"), error instanceof Error ? error.message : String(error));
  } finally {
    channel?.postMessage("changed");
    await refresh().catch(() => {});
    void settings.refresh();
  }
}
// A dot on Settings while a backup is due.
async function showBackupReminder() {
  const [lastBackup, kept] = await Promise.all([loadSetting("last-backup").catch(() => undefined), storageProtected()]);
  element("settings-open").dataset.state = backupDue(maps, lastBackup, Date.now(), kept !== false) ? "due" : "";
}
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
    .catch((error) => showMessage(t("Couldn’t delete map"), String(error)));
});
element("back").addEventListener("click", closeViewer);
channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "annotations" &&
      "mapId" in data && data.mapId === currentMap?.id)
    void controls?.refreshImports().catch((error) => showMessage(t("Could not refresh shared items"), String(error)));
  if (!importing)
    void refresh().catch((error) =>
      showMessage(t("Storage unavailable"), String(error)),
    );
});

// OCR runs in the background, outside the storage lock, so the library stays
// usable. It commits only full scans, and only while the map still exists.
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
      t("Text detection is already running. Let it finish or stop it first."),
    );
  let previous: OcrIndex | undefined;
  let release = () => {};
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = {
    mapId: map.id,
    controller,
    message: t("Starting local text detection…"),
    fraction: 0,
    done,
  };
  ocrJob = job;
  ocrErrors.delete(map.id);
  const update = () => {
    if (currentMap?.id === map.id)
      controls?.updateOcr(previous, job.message, job.fraction);
    if (selectedMap?.id === map.id) {
      element("ocr-status").textContent = job.message;
      element<HTMLButtonElement>("rerun-ocr").disabled = true;
      element("stop-ocr").hidden = false;
    }
  };
  try {
    previous = await loadOcr(map.id);
    update();
    const started = Date.now();
    const index = await detectMapText(
      map,
      (progress) => {
        job.message = progress.message;
        job.fraction = progress.fraction;
        update();
        onProgress(progress);
      },
      controller.signal,
    );
    track("text_scanned", { ok: true, labels: index.lines.length, seconds: Math.round((Date.now() - started) / 1000) });
    if (currentMap?.id === map.id) controls?.updateOcr(index);
    channel?.postMessage("changed");
    return index;
  } catch (error) {
    if (!controller.signal.aborted) track("text_scanned", { ok: false });
    const message = controller.signal.aborted
      ? t("Text detection stopped. Rerun it in Advanced settings.")
      : t("Text detection failed. Rerun it in Advanced settings.");
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
    const job = ocrJob?.mapId === map.id ? ocrJob : undefined;
    controls?.updateOcr(index, job?.message, job?.fraction);
    // Another map's scan restarts this one when it ends.
    if (!needsOcr(index) || ocrJob) return;
    await runOcr(map, new AbortController());
  } catch (error) {
    if (version === openVersion && !ocrErrors.has(map.id))
      controls?.updateOcr(
        undefined,
        t("{error} Retry in the map’s Advanced settings.", { error: String(error) }),
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
        ? `${plural(index.lines.length, "detected label")}\n${t("Last scanned {date}", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(index.completedAt) })}`
        : t("Text detection has not run yet.")));
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
  void runOcr(map, new AbortController())
    .catch((error) => {
      if (!ocrErrors.has(map.id))
        showMessage(t("Couldn’t start text detection"), String(error));
    })
    .finally(() => void renderOcrSettings());
});
initKeyboardInset();
initTapAway("dialog, #settings");
lockPageZoom();
void registerOfflineShell().then(refreshFooter);
async function start() {
  // Maps imported in a browser tab stay there, so a tab only shows how to install.
  if (import.meta.env.PROD && !isInstalled()) {
    track("app_opened", { installed: false });
    home.hidden = true;
    return initInstallPage(element("install"), element("install-dialog"));
  }
  await mutate(async () => {
    for (const map of await listMaps())
      if (map.status !== "ready") await deleteStoredMap(map);
  }).catch(() => {}); // Another tab may legitimately be importing; don't touch its files.
  await refresh();
  // Ask on every launch: Chrome may grant it later, once the app is installed or used more.
  if (maps.length) void protectStorage().then(showBackupReminder);
  void storageProtected().then((kept) => track("app_opened", {
    installed: true, maps: maps.length, protected: kept ?? "unknown", language,
    "label-size": preference("label-size"), "update-install": preference("update-install"),
  }));
  if (import.meta.env.DEV) await restoreDevData().catch((error) => console.warn("Dev data", error));
  // Reloading on the Settings page stays there.
  if (history.state?.settings) return showSettings();
  const resume = await lastMap();
  const map = maps.find((map) => map.id === resume);
  if (map) await openMap(map);
}
// A dev server on a new port starts empty; it brings back the shared dev maps.
async function restoreDevData() {
  const { devBackups, loadDevBackup } = await import("./dev-data");
  for (const backup of await devBackups())
    if (backup.maps.some((id) => !maps.some((map) => map.id === id)))
      await restore(await loadDevBackup(backup.name));
}
void start().catch((error) =>
  showMessage(
    t("Local storage unavailable"),
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
