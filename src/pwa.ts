import { t } from "./i18n";
// Prepare the offline shell automatically; explicit checks verify readiness.
export async function registerOfflineShell() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    // Installation is atomic: ready means every shell asset, including WASM, cached.
    void registration.update().catch(() => {});
  } catch {} // Offline checks report unavailable or incomplete setup.
}

export async function verifyOfflineShell(): Promise<{
  ready: boolean;
  message: string;
}> {
  if (!("serviceWorker" in navigator))
    return {
      ready: false,
      message: t("Offline startup needs a browser with service-worker support."),
    };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker)
    return {
      ready: false,
      message:
        t("Use the production build over HTTPS (or localhost) and wait for the app to finish its offline setup."),
    };
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (result: { ready: boolean; message: string }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          ready: false,
          message:
            t("Close other Mega Maps windows and reopen to finish the app update, then check again."),
        }),
      5000,
    );
    channel.port1.onmessage = (
      event: MessageEvent<{ ready: boolean; missing: string[] }>,
    ) =>
      finish({
        ready: event.data.ready,
        message: event.data.ready
          ? t("App shell checked offline.")
          : t("Some application files are missing. Reopen online to prepare the app, then check again."),
      });
    worker.postMessage({ type: "verify-shell" }, [channel.port2]);
  });
}
