import { verifyOfflineShell } from "../pwa";
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

// Mirrored halves: last update left, connection (with offline use beneath) right.
export const libraryFooterMarkup = `<footer class="library-footer"><div class="footer-side footer-updated"><span class="footer-icon">${icons.rotateRight}</span><span><strong><time id="app-updated-at">Checking…</time></strong><small>Last update</small></span></div><div class="footer-side" id="internet-status" data-state="checking" role="status" aria-live="polite"><span class="footer-icon">${icons.online}</span><span><strong>Checking…</strong><small id="offline-availability">Offline use</small></span></div></footer>`;

export function initLibraryFooter(home: HTMLElement) {
  const updated = home.querySelector<HTMLTimeElement>("#app-updated-at")!;
  const internet = home.querySelector<HTMLElement>("#internet-status")!;
  const offline = home.querySelector<HTMLElement>("#offline-availability")!;
  const builtAt = document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content;
  const date = new Date(builtAt ?? "");
  if (Number.isFinite(date.getTime())) {
    updated.dateTime = date.toISOString();
    updated.textContent = `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    updated.title = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } else {
    updated.textContent = import.meta.env.DEV ? "Development" : "Unknown";
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
    internet.title = reachable ? "" : online ? "Connected, but Mega Maps can't be reached" : "No internet";
    internet.querySelector(".footer-icon")!.innerHTML = reachable ? icons.online : icons.noInternet;
    internet.querySelector("strong")!.textContent = reachable ? "Online" : "Offline";
    // Missing offline files are a problem; having no signal underground is normal.
    offline.dataset.state = shell.ready ? "available" : "unavailable";
    offline.textContent = shell.ready ? "Works offline" : "Not saved offline";
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
