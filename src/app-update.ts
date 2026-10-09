export type AppUpdate = {
  version: string;
  /** Bytes to download, or 0 when the host did not say. */
  size: number;
  releasedAt?: Date;
  /** The new version is already installed in the background; only a restart is needed. */
  downloaded: boolean;
};

export type DownloadProgress = { loaded: number; total: number };

// Bound network and lifecycle waits so a failed update leaves the current app usable.
async function withTimeout<T>(work: Promise<T>, milliseconds = 30_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The update timed out. Check your connection and try again.")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A full download can take minutes on a slow connection: fail only once it stalls.
function stallTimer(milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail = () => {};
  const stalled = new Promise<never>((_, reject) => {
    fail = () => reject(new Error("The update stopped downloading. Check your connection and try again."));
  });
  stalled.catch(() => {});
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(fail, milliseconds);
  };
  touch();
  return {
    touch,
    race: <T>(work: Promise<T>) => Promise.race([work, stalled]),
    stop: () => clearTimeout(timer),
  };
}

// Activation and control are separate: reload only once the new worker owns this page.
async function waitForControl(worker: ServiceWorker, container: ServiceWorkerContainer, activity: () => void) {
  let check = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      check = () => {
        activity();
        if (worker.state === "redundant")
          reject(new Error("The update could not be installed. Your saved data is unchanged."));
        else if (worker.state === "activated" && container.controller === worker)
          resolve();
        else if (worker.state === "installed")
          worker.postMessage({ type: "skip-waiting" });
      };
      worker.addEventListener("statechange", check);
      container.addEventListener("controllerchange", check);
      check();
    });
  } finally {
    worker.removeEventListener("statechange", check);
    container.removeEventListener("controllerchange", check);
  }
}

async function shellVersion(worker: ServiceWorker) {
  const channel = new MessageChannel();
  try {
    return await withTimeout(new Promise<string>((resolve, reject) => {
      channel.port1.onmessage = (event: MessageEvent<{ ready: boolean; version?: string }>) => {
        if (!event.data.ready || !event.data.version)
          reject(new Error("The updated app is not ready for offline use. Try again while online."));
        else resolve(event.data.version);
      };
      worker.postMessage({ type: "verify-shell" }, [channel.port2]);
    }), 10_000);
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}

// Ask the host which version is live without starting a download.
export async function findAppUpdate(
  loadedVersion: string,
  container: ServiceWorkerContainer = navigator.serviceWorker,
  request: typeof fetch = fetch,
): Promise<AppUpdate | undefined> {
  let response: Response;
  try {
    response = await withTimeout(request(`/app-version.json?check=${Date.now()}`, { cache: "no-store" }), 15_000);
  } catch {
    throw new Error("Couldn’t reach Mega Maps. Check your connection and try again.");
  }
  const latest: { version?: unknown; size?: unknown; builtAt?: unknown } | undefined =
    response.ok ? await response.json().catch(() => undefined) : undefined;
  if (typeof latest?.version !== "string")
    throw new Error("Couldn’t read the latest version information. Try again later.");
  if (latest.version === loadedVersion) return undefined;
  const releasedAt = new Date(typeof latest.builtAt === "string" ? latest.builtAt : "");
  const registration = await container.getRegistration("/").catch(() => undefined);
  const worker = container.controller ?? registration?.active;
  const downloaded = worker
    ? await shellVersion(worker).then((version) => version === latest.version, () => false)
    : false;
  return {
    version: latest.version,
    size: typeof latest.size === "number" && latest.size > 0 ? latest.size : 0,
    releasedAt: Number.isFinite(releasedAt.getTime()) ? releasedAt : undefined,
    downloaded,
  };
}

// Updating replaces only the application shell; IndexedDB and map files are untouched.
// Resolves true once a newer version controls this page and a reload will apply it.
export async function installAppUpdate(
  loadedVersion: string,
  onProgress: (progress: DownloadProgress) => void = () => {},
  container: ServiceWorkerContainer = navigator.serviceWorker,
) {
  const timer = stallTimer(30_000);
  const progress = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || !("type" in data) || data.type !== "install-progress") return;
    const { loaded, total } = data as { loaded?: unknown; total?: unknown };
    if (typeof loaded !== "number" || typeof total !== "number") return;
    timer.touch();
    onProgress({ loaded, total });
  };
  container.addEventListener("message", progress as EventListener);
  container.startMessages?.();
  try {
    const registration = await timer.race(container.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }));
    await timer.race(registration.update());
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("The app update is not ready. Try again while online.");
    await timer.race(waitForControl(worker, container, timer.touch));
    return (await shellVersion(worker)) !== loadedVersion;
  } finally {
    timer.stop();
    container.removeEventListener("message", progress as EventListener);
  }
}
