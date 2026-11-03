import { verifyOfflineShell } from "../pwa";
import { locale, t } from "../i18n";
import { icons } from "./icons";

// A fresh, recognizable response proves the live app is reachable, not just cached.
export async function checkAppReachability(online: boolean, request = fetch) {
  if (!online) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(`/app-status.json?check=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "app" in body && body.app === "mega-maps";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const pad = (value: number) => String(value).padStart(2, "0");

// Mirrored halves: last update left (or a ready update to install), connection
// (with offline use beneath) right.
export const libraryFooterMarkup = `<footer class="library-footer"><button type="button" class="footer-side footer-updated" id="app-update-status"><span class="footer-icon">${icons.update}<span class="update-dot" aria-hidden="true"></span></span><span><strong><time id="app-updated-at">${t("Checking…")}</time><span id="update-ready" hidden>${t("Update ready")}</span></strong><small id="update-hint" class="update-hint">${t("Last update")}</small></span></button><div class="footer-side" id="internet-status" data-state="checking" role="status" aria-live="polite"><span class="footer-icon">${icons.online}</span><span><strong>${t("Checking…")}</strong><small class="footer-offline">${icons.offlineReady}<span id="offline-availability">${t("Offline use")}</span></small></span></div></footer>`;

/** findUpdate resolves true when a newer version than the loaded one is live. */
export function initLibraryFooter(home: HTMLElement, findUpdate?: () => Promise<boolean>) {
  const updated = home.querySelector<HTMLTimeElement>("#app-updated-at")!;
  const updateStatus = home.querySelector<HTMLElement>("#app-update-status")!;
  const updateReady = home.querySelector<HTMLElement>("#update-ready")!;
  const updateHint = home.querySelector<HTMLElement>("#update-hint")!;
  const internet = home.querySelector<HTMLElement>("#internet-status")!;
  const offline = home.querySelector<HTMLElement>("#offline-availability")!;
  const builtAt = document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content;
  const date = new Date(builtAt ?? "");
  if (Number.isFinite(date.getTime())) {
    updated.dateTime = date.toISOString();
    updated.textContent = `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    updated.title = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } else {
    updated.textContent = import.meta.env.DEV ? t("Development") : t("Unknown");
  }

  let revision = 0;
  async function refresh() {
    const current = ++revision;
    const online = navigator.onLine;
    const [reachable, shell] = await Promise.all([
      checkAppReachability(online),
      verifyOfflineShell().catch(() => ({ ready: false })),
    ]);
    if (revision !== current) return;
    internet.dataset.state = reachable ? "available" : "idle";
    internet.title = reachable ? "" : online ? t("Connected, but Mega Maps can't be reached") : t("No internet");
    internet.querySelector(".footer-icon")!.innerHTML = reachable ? icons.online : icons.noInternet;
    internet.querySelector("strong")!.textContent = reachable ? t("Online") : t("Offline");
    // Missing offline files are a problem; having no signal underground is normal.
    offline.dataset.state = shell.ready ? "available" : "unavailable";
    offline.textContent = shell.ready ? t("Offline ready") : t("Not saved offline");

    // Only the live site knows about new versions; offline keeps the last answer.
    if (!reachable || !findUpdate) return;
    const ready = await findUpdate().catch(() => undefined);
    if (revision !== current || ready === undefined) return;
    updateStatus.dataset.state = ready ? "ready" : "";
    updated.hidden = ready;
    updateReady.hidden = !ready;
    updateHint.textContent = ready ? t("Tap to install") : t("Last update");
  }

  // Checks fetch the live site and ask the service worker, so they run only
  // while the main menu shows them; going home refreshes the footer anyway.
  const refreshShown = () => {
    if (!document.hidden && !home.hidden) void refresh();
  };
  for (const type of ["online", "offline", "pageshow"])
    window.addEventListener(type, refreshShown);
  document.addEventListener("visibilitychange", refreshShown);
  navigator.serviceWorker?.addEventListener("controllerchange", refreshShown);
  window.setInterval(refreshShown, 60_000);
  void refresh();
  return refresh;
}
