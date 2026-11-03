import { dialogHeader, showDialog } from "./ui/dialog";
import "./style.css";
import { tileKey, type MapRecord } from "./types";
import { listMaps, markOpened, renameMap } from "./storage/database";
import { payloadStore, deleteAllData, deleteStoredMap } from "./storage/payloads";
import { importMap } from "./processing/import";
import { startRetiling } from "./processing/retile";
import { Viewer } from "./viewer/viewer";
import { registerOfflineShell } from "./pwa";
import { findAppUpdate, installAppUpdate } from "./app-update";
import { icons } from "./ui/icons";
import { displayName, formatBytes, lastUsed, plural, timeLeft } from "./ui/format";
import { viewerMarkup } from "./ui/viewer-markup";
import { ViewerControls } from "./ui/viewer-controls";
import { loadNavigation, lastMap, setLastMap } from "./storage/navigation";
import { photoBytes, prunePhotos } from "./storage/photos";
import { darkMode, measureTone } from "./viewer/appearance";
import { initLibraryFooter } from "./ui/library-footer";
import { homeMarkup, importDialogsMarkup, mapDialogsMarkup } from "./ui/library-markup";
import { initKeyboardInset, initTapAway } from "./ui/keyboard-inset";
import { lockPageZoom } from "./ui/page-zoom";
import { loadOcr } from "./storage/ocr";
import { needsOcr, type OcrIndex } from "./ocr/index";
import { detectMapText, ocrWorkerCount } from "./ocr/detect";
import { ocrCrops } from "./ocr/scan";
import { initMapRename, mapRenameMarkup } from "./ui/map-rename";
import { showActionSheet } from "./ui/action-sheet";
import { initSharing, sharingMarkup } from "./ui/sharing";
import { initUpdateDialog, updateDialogMarkup } from "./ui/update-dialog";
import { eraseDialogMarkup, initSettingsPage, resetMarkup, restoreDialogMarkup, settingsMarkup } from "./ui/settings-page";
import { backupDue, isBackupFile, restoreBackup, type Backup } from "./storage/backup";
import { loadSetting } from "./storage/settings";
import { protectStorage, storageProtected } from "./storage/protection";
import { language, locale, t, errorMessage } from "./i18n";
import { preference, resetPreferences, setPreference } from "./preferences";
import { importAnnotations, importNewCopy } from "./sharing/storage";
import { isShareFile } from "./sharing/format";
import { initInstallPage, installMarkup, isInstalled } from "./ui/install-page";
import { initWelcome, welcomeMarkup } from "./ui/welcome";
import { initWhatsNew, whatsNewMarkup } from "./ui/whats-new";
import { describeApp, initHelp } from "./ui/help";
import { failure, setPerson, startStats, track } from "./stats";

document.documentElement.lang = language;
document.documentElement.dataset.labels = preference("label-size");
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  ${homeMarkup(import.meta.env.MODE === "production" ? "" : ' <span class="dev-title">Dev</span>')}
  ${settingsMarkup}
  ${resetMarkup}
  ${installMarkup}
  <section id="viewer" class="viewer" aria-label="${t("Map viewer")}" hidden>${viewerMarkup}</section>
  <input type="file" id="file-input" hidden>
  ${importDialogsMarkup}
  <dialog id="message-dialog" aria-labelledby="message-title" aria-describedby="message-body">${dialogHeader("message-title", "", icons.sparkle, "message-dismiss")}<p id="message-body"></p><button class="primary" id="message-close">${icons.check}<span>${t("Got it")}</span></button><a class="quiet" id="message-report" target="_blank" rel="noopener" data-help="problem" hidden>${icons.bug}<span>${t("Report this problem")}</span></a></dialog>
  <dialog id="delete-dialog" aria-labelledby="delete-title">${dialogHeader("delete-title", t("Delete this map?"), icons.trash, "delete-cancel")}<p id="delete-name" class="delete-map"></p><p class="dialog-note" id="delete-note"></p><div class="dialog-actions"><button class="danger" id="delete-confirm">${icons.trash}<span>${t("Delete map")}</span></button></div></dialog>
  ${mapRenameMarkup}
  ${sharingMarkup}
  ${updateDialogMarkup}
  ${restoreDialogMarkup}
  ${eraseDialogMarkup}
  ${welcomeMarkup}
  ${whatsNewMarkup}
  ${mapDialogsMarkup}
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
      /** Roughly how long the scan has left, once it can tell. */
      left: string;
      done: Promise<void>;
    }
  | undefined;
const ocrErrors = new Map<string, string>();
const settingsPage = element("settings");
const loadedVersion = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? "";
const loadedRelease = new Date(document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content ?? "");
// Stamped together with the date, so a known date means a real name, not the placeholder.
const releaseName = Number.isFinite(loadedRelease.getTime())
  ? document.querySelector<HTMLMetaElement>('meta[name="app-release"]')?.content
  : undefined;
// The dev site (`npm run build:dev`) is for trying changes: it sends no stats.
const released = import.meta.env.PROD && import.meta.env.MODE !== "dev";
if (released) {
  // A browser tab only shows how to install, and sends nothing.
  if (isInstalled()) startStats(releaseName ?? loadedVersion);
}
const help = initHelp(app, describeApp(releaseName ?? loadedVersion, isInstalled()));
const canUpdate = import.meta.env.PROD && "serviceWorker" in navigator;
const settings = initSettingsPage(settingsPage, {
  reset: element("reset"),
  restore: element<HTMLDialogElement>("restore-dialog"),
  erase: element<HTMLDialogElement>("erase-dialog"),
}, {
  release: releaseName,
  back: hideSettings,
  checkUpdates: openUpdates,
  openWhatsNew: () => whatsNew.openAll(),
  restore: (backup) => void restore(backup),
  erase: (what) => void (what === "app" ? reset() : erase()),
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
/** While the example map is being added; a map picked meanwhile waits for it. */
let preparingExample: Promise<void> | undefined;
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
function showMessage(title: string, message: string, problem = false, detail = message) {
  element("message-title").textContent = title;
  element("message-body").textContent = message;
  const report = element<HTMLAnchorElement>("message-report");
  report.hidden = !problem;
  if (problem) help.report(report, { title, error: detail });
  if (!messageDialog.open) showDialog(messageDialog);
}
// Something went wrong: say what, and offer to report it with the browser's own words filled in.
const showError = (title: string, error: unknown) =>
  showMessage(title, errorMessage(error), true, failure(error));
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
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        track("share_imported", { ok: false, into: destination.mapId ? destination.mode : "new", error: failure(error) });
      throw error;
    } finally {
      progressDialog.close();
      importing = undefined;
    }
  },
  imported: async (result, destination) => {
    track("share_imported", { ok: true, into: destination.mapId ? destination.mode : "new", items: result.added });
    await refresh();
    await openMap(result.map);
    if (!destination.mapId) {
      showMessage(t("Share imported"), t("{items} added to a new map.", { items: plural(result.added, "item") }));
      // A share without its text scan asks once its summary is read.
      if (needsOcr(await loadOcr(result.map.id).catch(() => undefined)))
        messageDialog.addEventListener("close", () => {
          if (currentMap?.id === result.map.id) offerTextDetection(result.map);
        }, { once: true });
    }
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
    showError(t("Could not prepare share"), error);
  }
}
// An origin-wide lock prevents launch cleanup from racing another tab's import.
// Recutting maps steps aside for any change and resumes after it. With `wait`,
// work another window holds storage for waits its turn, until it is cancelled.
async function mutate<T>(work: () => Promise<T>, wait?: { signal: AbortSignal; waiting: () => void }): Promise<T> {
  await stopRetiling();
  try {
    if (!navigator.locks) return await work();
    const held = await navigator.locks.request("map-viewer-storage", { ifAvailable: true },
      async (lock) => lock ? { result: await work() } : undefined);
    if (held) return held.result;
    if (!wait)
      throw new Error(t("Mega Maps is preparing a map in another window. Let it finish first."));
    wait.waiting();
    return await navigator.locks.request("map-viewer-storage", { signal: wait.signal }, work);
  } finally {
    retileMaps();
  }
}
let retiling: ReturnType<typeof startRetiling> | undefined;
// Maps in older tile formats are quietly recut; the open map and its text scan are left alone.
function retileMaps() {
  if (retiling || !navigator.locks) return;
  const job = startRetiling(
    (id) => id === currentMap?.id || id === ocrJob?.mapId,
    (id) => {
      const url = thumbnails.get(id);
      if (url) URL.revokeObjectURL(url);
      thumbnails.delete(id);
    },
  );
  retiling = job;
  void job.done.then(() => {
    if (retiling === job) retiling = undefined;
  });
}
async function stopRetiling() {
  const job = retiling;
  retiling = undefined;
  await job?.stop();
}
const appTitle = document.title;
/** The open map names the tab and the app switcher entry. */
function showTitle() {
  document.title = currentMap ? `${displayName(currentMap.name)} · ${appTitle}` : appTitle;
}
// Going home returns to the same place in the list, on the map just closed.
let libraryScroll = 0;
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
    showError(t("Could not save home view"), error),
  );
  viewerSection.hidden = true;
  home.hidden = false;
  void refreshFooter();
  retileMaps();
  document.body.classList.remove("viewing");
  void refresh()
    .then(() => {
      // The map just left now leads the list; the library opens at it.
      if (!home.hidden) window.scrollTo(0, maps[0]?.id === closed ? 0 : libraryScroll);
    })
    .catch((error) => showError(t("Storage unavailable"), error));
}
async function openMap(map: MapRecord) {
  const version = ++openVersion;
  if (controls) pendingViewSave = controls.dispose();
  controls = undefined;
  viewer?.dispose();
  viewer = undefined;
  if (!home.hidden) libraryScroll = window.scrollY;
  currentMap = map;
  if (retiling?.mapId === map.id) void stopRetiling();
  map.opened = Date.now();
  void markOpened(map.id, map.opened).catch(() => {});
  showTitle();
  viewerSection.hidden = false;
  home.hidden = true;
  document.body.classList.add("viewing");
  const started = Date.now();
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
      // No zoom readout: the map is the only thing on screen.
      () => {},
      (message) => {
        if (!reported) showError(t("Couldn’t show this map"), message);
        reported = true;
      },
      controls.options(),
    );
    controls.attach(viewer);
    track("map_opened", { ok: true, example: !!map.example, megapixels: Math.round(map.width * map.height / 1e6),
      places: state.markers.length, routes: state.routes.length, ms: Date.now() - started });
    void prepareMapSearch(map, version);
    await setLastMap(map.id);
  } catch (error) {
    if (version === openVersion) {
      track("map_opened", { ok: false, error: failure(error) });
      closeViewer();
      showError(t("Could not open map"), error);
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
              job?.left,
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
  // Until there's a map of their own, the example doesn't stand in for one:
  // the invitation to import stays below it.
  const onlyExample = maps.length > 0 && maps.every((map) => map.example);
  element("empty").hidden = maps.length > 0 && !onlyExample;
  element("empty-title").textContent = onlyExample ? t("Now import your own map") : t("Your next route starts here");
  element("example-done").hidden = !(maps.some((map) => map.example) && maps.some((map) => !map.example)
    && preference("example-offer") !== "seen");
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
    // (which is also the list's order) follows, with what it takes on the
    // device on the right.
    const size = Object.assign(document.createElement("span"), { className: "map-size", innerHTML: icons.storage });
    const sizeText = size.appendChild(document.createTextNode(""));
    card.querySelector(".map-meta")!.append(Object.assign(document.createElement("span"), { textContent: lastUsed(map) }), size);
    // The original is only part of it: tiles cut from it and photos weigh too.
    const tiles = map.tileBytes ?? 0;
    let storage = [t("Image {size}", { size: formatBytes(map.bytes) }), t("Tiles {size}", { size: formatBytes(tiles) })];
    const showSize = (photos: number) => {
      sizeText.data = formatBytes(map.bytes + tiles + photos);
    };
    showSize(0);
    void photoBytes(map.id)
      .then((photos) => {
        if (version !== renderVersion || !photos) return;
        showSize(photos);
        storage = [...storage, t("Photos {size}", { size: formatBytes(photos) })];
      })
      .catch(() => {});
    const saved = card.querySelector(".map-saved")!;
    // Leaving a map may still be writing its last edits.
    const navigation = pendingViewSave
      .catch(() => {})
      .then(() => loadNavigation(map.id));
    void navigation
      .then(({ markers, routes }) => {
        if (version !== renderVersion) return;
        const counts = [
          [markers.length, "place", icons.pin, "saved-places"],
          [routes.length, "route", icons.route, "saved-routes"],
        ] as const;
        const shown = counts.filter(([count]) => count);
        // Places and routes carry their map colors and icons, so the number
        // alone reads; "nothing" stays plain text.
        saved.replaceChildren(...shown.map(([count, word, icon, className]) => {
          const label = plural(count, word);
          const part = Object.assign(document.createElement("span"), { className, innerHTML: icon, title: label });
          part.setAttribute("aria-label", label);
          part.append(count.toLocaleString(locale));
          return part;
        }));
        if (!shown.length) saved.textContent = t("Nothing saved yet");
        saved.classList.toggle("none", !shown.length);
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
        detail: storage.join(" · "),
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
      const img = new Image();
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      // A dragged thumbnail would carry its image as a file, and dropped back
      // on the library it would import as a new map.
      img.draggable = false;
      // A preview shown before keeps its look at once, so coming home doesn't
      // flash placeholders while the map's settings are read again.
      const known = shownFilters.get(map.id);
      if (known !== undefined) {
        img.style.filter = known;
        card.querySelector(".thumbnail")!.prepend(img);
      }
      const inverted = await navigation.then((state) => state.inverted, () => false);
      const filter = inverted ? await darkFilter(map.id, url) : "";
      if (version !== renderVersion) return;
      shownFilters.set(map.id, filter);
      img.style.filter = filter;
      if (!img.isConnected) card.querySelector(".thumbnail")!.prepend(img);
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
// Asked once: removing goes through the usual delete, keeping just hides it.
for (const [id, remove] of [["example-remove", true], ["example-keep", false]] as const)
  element(id).addEventListener("click", () => {
    setPreference("example-offer", "seen");
    element("example-done").hidden = true;
    track("example_offer_answered", { remove });
    const example = maps.find((map) => map.example);
    if (remove && example) confirmDelete(example);
  });
const importDialog = element<HTMLDialogElement>("import-dialog");
element("import-open").addEventListener("click", () => showDialog(importDialog));
// The whole empty card is a target too; Import stays the labelled control.
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
  await preparingExample;
  if (importing) return;
  if (await isShareFile(file).catch(() => false)) void sharing.openImport(file);
  else if (await isBackupFile(file).catch(() => false))
    void settings.review(file).catch((error) => showError(t("Couldn’t read this backup"), error));
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
  // Which kinds of file people pick, to see what fails; the name itself is never sent.
  const kind = { type: file.type || "none", extension: /\.(\w{1,10})$/.exec(file.name)?.[1]?.toLowerCase() ?? "none" };
  // The map opens once its tiles are saved; text detection waits for a yes.
  void mutate(() =>
    importMap(
      file,
      (progress) => showProgress(progress.fraction * 100, progress.message),
      controller.signal,
    ), { signal: controller.signal, waiting: () => showProgress(0, t("Waiting for Mega Maps to finish in another window…")) },
  )
    .then(async (map) => {
      track("map_imported", { ok: true, ...kind, megapixels: Math.round(map.width * map.height / 1e6), shrunk: !!map.shrunkFrom, seconds: Math.round((Date.now() - started) / 1000) });
      channel?.postMessage("changed");
      progressDialog.close();
      importing = undefined;
      await refresh();
      await openMap(map);
      if (currentMap?.id === map.id) offerTextDetection(map);
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      track("map_imported", { ok: false, ...kind, error: failure(error) });
      showError(t("Couldn’t import this map"), error);
    })
    .finally(() => {
      progressDialog.close();
      importing = undefined;
    });
}
// The tab title carries the percentage too, for imports left in the background.
// Rounded down, so 100% only shows once the work is done.
// When the shown task started, for its estimate; a task starting over resets it.
let progressStarted = 0, lastPercent = 0;
function showProgress(percent: number, message: string) {
  const rounded = Math.floor(percent);
  if (percent <= 0 || percent < lastPercent) progressStarted = performance.now();
  lastPercent = percent;
  const left = timeLeft(percent / 100, performance.now() - progressStarted);
  element("progress-fill").style.width = `${percent}%`;
  element("progress-percent").textContent = left ? `${rounded}% · ${left}` : `${rounded}%`;
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
const welcome = initWelcome(element("welcome"), {
  hasExample: () => preparingExample !== undefined || maps.some((map) => map.example),
  importMap: () => showDialog(importDialog),
  openExample: () => void openExample(),
});
const whatsNew = initWhatsNew(element("whats-new"));
// The example map, made again first if it went meanwhile.
async function openExample() {
  if (!maps.some((map) => map.example)) {
    if (importing && !preparingExample)
      return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
    await (preparingExample ??= addExample(true).finally(() => (preparingExample = undefined)));
  }
  const example = maps.find((map) => map.example);
  if (!example) return;
  if (currentMap?.id !== example.id) await openMap(example);
}
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
// Nothing adds history entries, so an edge swipe has nowhere to go: only the
// Back buttons leave a map or Settings.
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
element("settings-open").addEventListener("click", showSettings);
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
    track("backup_restored", { ok: true, maps: result.added });
    progressDialog.close();
    showMessage(t("Backup restored"), t("{maps} added to your library.", { maps: plural(result.added, "map") }));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      track("backup_restored", { ok: false, error: failure(error) });
      showError(t("Couldn’t restore the backup"), error);
    }
  } finally {
    progressDialog.close();
    importing = undefined;
    channel?.postMessage("changed");
    // The app starts again so every screen loads the restored maps, once the outcome is read.
    if (messageDialog.open) messageDialog.addEventListener("close", () => location.reload(), { once: true });
    else location.reload();
  }
}
// Reset's Delete all data, once its three steps are confirmed.
async function erase() {
  if (importing || ocrJob || updates.busy)
    return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
  try {
    await mutate(deleteAllData);
    showMessage(t("Everything deleted"), t("No maps, places or photos are left on this device."));
  } catch (error) {
    showError(t("Couldn’t delete everything"), error);
  } finally {
    channel?.postMessage("changed");
    await refresh().catch(() => {});
    void settings.refresh();
  }
}
// Reset's Reset the app, once its three steps are confirmed: all data, then every setting.
// The app starts again as if just installed, with the welcome and the example map.
async function reset() {
  if (importing || ocrJob || updates.busy)
    return showMessage(t("Finish the current task first"), t("Mega Maps is busy with a map. Let it finish, then try again."));
  try {
    await mutate(deleteAllData);
    resetPreferences();
    channel?.postMessage("changed");
    location.reload();
  } catch (error) {
    showError(t("Couldn’t reset the app"), error);
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
    .catch((error) => showError(t("Couldn’t delete map"), error));
});
element("back").addEventListener("click", closeViewer);
channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "annotations" &&
      "mapId" in data && data.mapId === currentMap?.id)
    void controls?.refreshImports().catch((error) => showError(t("Could not refresh shared items"), error));
  if (!importing)
    void refresh().catch((error) =>
      showError(t("Storage unavailable"), error),
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
    left: "",
    done,
  };
  ocrJob = job;
  ocrErrors.delete(map.id);
  if (retiling?.mapId === map.id) await stopRetiling();
  const update = () => {
    if (currentMap?.id === map.id)
      controls?.updateOcr(previous, job.message, job.fraction, job.left);
    if (selectedMap?.id === map.id) {
      element("ocr-status").textContent = job.left ? `${job.message} · ${job.left}` : job.message;
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
        job.left = timeLeft(progress.fraction, Date.now() - started);
        update();
        onProgress(progress);
      },
      controller.signal,
    );
    // How the scan was spread, to tell slow phones from scans that ran on too few workers.
    const sections = ocrCrops(map.width, map.height).length;
    track("text_scanned", { ok: true, labels: index.lines.length, seconds: Math.round((Date.now() - started) / 1000),
      sections, workers: ocrWorkerCount(sections), cores: navigator.hardwareConcurrency || 0 });
    if (currentMap?.id === map.id) controls?.updateOcr(index);
    channel?.postMessage("changed");
    return index;
  } catch (error) {
    track("text_scanned", { ok: false, ...controller.signal.aborted ? { stopped: true } : { error: failure(error) } });
    // A full device fails the save at the end; rerunning wouldn't help until there's room.
    const message = controller.signal.aborted
      ? t("Text detection stopped. Rerun it in Advanced settings.")
      : error instanceof Error && error.name === "QuotaExceededError" ? errorMessage(error)
      : t("Text detection failed. Rerun it in Advanced settings.");
    ocrErrors.set(map.id, message);
    if (currentMap?.id === map.id) controls?.updateOcr(previous, message);
    throw error;
  } finally {
    ocrJob = undefined;
    release();
    if (selectedMap?.id === map.id) void renderOcrSettings();
  }
}

// Scanning is slow and heavy, so it never starts without a yes: a new map asks,
// and so does a map scanned before detection improved. A no leaves it to
// Advanced settings; each map asks once per session.
const ocrOfferDialog = element<HTMLDialogElement>("ocr-offer-dialog");
const offeredMaps = new Set<string>();
let offeredMap: MapRecord | undefined;
let offerAccepted = false;
let offerUpdate = false;
function offerTextDetection(map: MapRecord, update = false) {
  if (offeredMaps.has(map.id) || ocrOfferDialog.open) return;
  offeredMaps.add(map.id);
  offeredMap = map;
  offerAccepted = false;
  offerUpdate = update;
  element("ocr-offer-title").textContent = update ? t("Update this map’s text search?") : t("Search this map’s text?");
  element("ocr-offer-body").textContent = update
    ? t("Text detection has improved since this map was scanned. Scanning again runs on this device and can take a while on large maps.")
    : t("Text detection reads the labels printed on the map so search can find them. It runs on this device and can take a while on large maps.");
  showDialog(ocrOfferDialog);
}
element("ocr-offer-start").addEventListener("click", () => {
  offerAccepted = true;
  ocrOfferDialog.close();
});
for (const id of ["ocr-offer-close", "ocr-offer-later"])
  element(id).addEventListener("click", () => ocrOfferDialog.close());
ocrOfferDialog.addEventListener("close", () => {
  const map = offeredMap;
  offeredMap = undefined;
  if (!map) return;
  track("text_scan_offered", { accepted: offerAccepted, update: offerUpdate });
  if (offerAccepted)
    void runOcr(map, new AbortController()).catch((error) => {
      if (!ocrErrors.has(map.id))
        showError(t("Couldn’t start text detection"), error);
    });
});

// Search uses whatever scan the map has; an outdated one offers a rescan.
async function prepareMapSearch(map: MapRecord, version: number) {
  try {
    const index = await loadOcr(map.id);
    if (version !== openVersion) return;
    const job = ocrJob?.mapId === map.id ? ocrJob : undefined;
    controls?.updateOcr(index, job?.message ?? ocrErrors.get(map.id), job?.fraction, job?.left);
    if (index && needsOcr(index) && !job) offerTextDetection(map, true);
  } catch (error) {
    if (version === openVersion && !ocrErrors.has(map.id))
      controls?.updateOcr(
        undefined,
        t("{error} Retry in the map’s Advanced settings.", { error: errorMessage(error) }),
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
    ? ocrJob!.left ? `${ocrJob!.message} · ${ocrJob!.left}` : ocrJob!.message
    : (ocrErrors.get(map.id) ??
      (index
        ? `${plural(index.lines.length, "detected label")}\n${t("Last scanned {date}", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(index.completedAt) })}`
        : t("Text detection has not run yet.")));
  element("rerun-ocr").querySelector("span")!.textContent = index ? t("Rerun text detection") : t("Run text detection");
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
        showError(t("Couldn’t start text detection"), error);
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
    home.hidden = true;
    return initInstallPage(element("install"), element("install-dialog"));
  }
  await mutate(async () => {
    for (const map of await listMaps())
      if (map.status !== "ready") await deleteStoredMap(map);
  }).catch(() => {}); // Another tab may legitimately be importing; don't touch its files.
  // Reopening on the last map skips building the library beneath it, whose
  // previews and counts would compete with the map for storage.
  const resume = await lastMap();
  if (resume) home.hidden = true;
  await refresh();
  // Ask on every launch: Chrome may grant it later, once the app is installed or used more.
  if (maps.length) void protectStorage().then(showBackupReminder);
  setPerson({ maps: maps.length, language });
  void storageProtected().then((kept) => track("app_opened", {
    installed: true, maps: maps.length, protected: kept ?? "unknown", language,
    "label-size": preference("label-size"), "update-install": preference("update-install"),
  }));
  if (import.meta.env.DEV) await restoreDevData().catch((error) => console.warn("Dev data", error));
  const map = maps.find((map) => map.id === resume);
  if (map) await openMap(map);
  else if (home.hidden) {
    home.hidden = false;
    await refresh();
  }
  retileMaps();
  // Made while the welcome shows, so it's ready to try.
  if (!maps.length && preference("tour") !== "seen")
    preparingExample = addExample().finally(() => (preparingExample = undefined));
  const welcomed = welcome.atLaunch(maps.length > 0);
  whatsNew.atLaunch(maps.length > 0, !welcomed);
}
// New users get the example map to try, made quietly while the welcome
// shows. Made again when opened from the welcome, it shows its progress.
async function addExample(shown = false) {
  const controller = new AbortController();
  importing = controller;
  if (shown) {
    element("progress-title").textContent = t("Preparing the example map");
    element("progress-title-icon").innerHTML = icons.map;
    element("progress-note").textContent = t("Keep Mega Maps open while your map is prepared.");
    element("import-name").textContent = t("Val Moulin (example)");
    showProgress(0, t("Reading image…"));
    showDialog(progressDialog);
  }
  try {
    const { addExampleMap } = await import("./example/example-map");
    await mutate(() => addExampleMap(controller.signal, shown ? (progress) => showProgress(progress.fraction * 100, progress.message) : undefined));
    track("example_map_added", { ok: true });
    channel?.postMessage("changed");
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError";
    if (!stopped) track("example_map_added", { ok: false, error: failure(error) });
    if (shown && !stopped) showError(t("Could not prepare the example map."), error);
  } finally {
    importing = undefined;
    if (shown) progressDialog.close();
  }
  await refresh().catch(() => {});
}
// A dev server on a new port starts empty; it brings back the shared dev maps.
async function restoreDevData() {
  const { devBackups, loadDevBackup } = await import("./dev-data");
  for (const backup of await devBackups())
    if (backup.maps.some((id) => !maps.some((map) => map.id === id)))
      await restore(await loadDevBackup(backup.name));
}
void start().catch((error) =>
  showError(t("Local storage unavailable"), error),
);
Object.defineProperty(window, "MapViewer", {
  value: {
    diagnostics: () => viewer?.diagnostics() ?? null,
    library: () => maps.map((m) => ({ ...m })),
  },
  configurable: true,
});
