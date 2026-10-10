import { verifyOfflineShell } from "../pwa";

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

// Keep live reachability and verified offline readiness independent in the footer.
export function initLibraryFooter(home: HTMLElement) {
  const updated = home.querySelector<HTMLTimeElement>("#app-updated-at")!;
  const internet = home.querySelector<HTMLElement>("#internet-status")!;
  const app = home.querySelector<HTMLElement>("#app-availability")!;
  const offline = home.querySelector<HTMLElement>("#offline-availability")!;
  const builtAt = document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content;
  const date = new Date(builtAt ?? "");
  if (Number.isFinite(date.getTime())) {
    updated.dateTime = date.toISOString();
    updated.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short",
    }).format(date);
    updated.title = "Release date of the version currently loaded";
  } else {
    updated.textContent = import.meta.env.DEV ? "Development" : "Unknown";
  }

  function status(element: HTMLElement, text: string, state: string) {
    element.textContent = text;
    element.dataset.state = state;
  }

  let revision = 0;
  async function refresh() {
    const current = ++revision;
    const online = navigator.onLine;
    if (!online) {
      status(internet, "No internet", "unavailable");
      status(app, "Live app unavailable", "unavailable");
    }
    const [reachable, shell] = await Promise.all([
      checkAppReachability(online),
      verifyOfflineShell().catch(() => ({ ready: false, message: "Offline setup unavailable" })),
    ]);
    if (revision !== current) return;
    status(internet, reachable ? "Internet connected" : online ? "Internet unconfirmed" : "No internet",
      reachable ? "available" : online ? "unknown" : "unavailable");
    status(app, reachable ? "Live app available" : "Live app unavailable",
      reachable ? "available" : "unavailable");
    status(offline, shell.ready ? "Available offline" : "Unavailable offline",
      shell.ready ? "available" : "unavailable");
    offline.title = shell.message;
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
