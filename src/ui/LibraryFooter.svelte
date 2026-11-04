<script lang="ts">
  import { verifyOfflineShell } from "../pwa";
  import { locale, t } from "../i18n";
  import { icons } from "./icons";
  import { checkAppReachability } from "./library-footer";
  import Icon from "./kit/Icon.svelte";
  import { dotClass } from "./kit/Row.svelte";

  // Mirrored halves: last update left (or a ready update to install), connection
  // (with offline use beneath) right.
  let { findUpdate, shown = true, onupdate }: {
    /** Resolves true when a newer version than the loaded one is live. */
    findUpdate?: () => Promise<boolean>;
    /** Checks run only while the main menu shows the footer. */
    shown?: boolean;
    onupdate?: () => void;
  } = $props();

  const pad = (value: number) => String(value).padStart(2, "0");
  const builtAt = new Date(document.querySelector<HTMLMetaElement>('meta[name="app-built-at"]')?.content ?? "");
  const built = Number.isFinite(builtAt.getTime()) ? builtAt : undefined;
  let reachable = $state<boolean>(), online = $state(true), offlineReady = $state<boolean>(), updateReady = $state(false);
  let revision = 0;

  /** Checks the connection, offline files and, on the live site, for a newer version. */
  export async function refresh() {
    const current = ++revision;
    const connected = navigator.onLine;
    const [live, shell] = await Promise.all([
      checkAppReachability(connected),
      verifyOfflineShell().catch(() => ({ ready: false })),
    ]);
    if (revision !== current) return;
    online = connected;
    reachable = live;
    offlineReady = shell.ready;
    // Only the live site knows about new versions; offline keeps the last answer.
    if (!live || !findUpdate) return;
    const ready = await findUpdate().catch(() => undefined);
    if (revision !== current || ready === undefined) return;
    updateReady = ready;
  }

  // Checks fetch the live site and ask the service worker, so they run only
  // while the main menu shows them; going home refreshes the footer anyway.
  const refreshShown = () => {
    if (!document.hidden && shown) void refresh();
  };
  $effect(() => {
    const worker = navigator.serviceWorker;
    worker?.addEventListener("controllerchange", refreshShown);
    const timer = setInterval(refreshShown, 60_000);
    void refresh();
    return () => {
      worker?.removeEventListener("controllerchange", refreshShown);
      clearInterval(timer);
    };
  });
</script>

<svelte:window ononline={refreshShown} onoffline={refreshShown} onpageshow={refreshShown} />
<svelte:document onvisibilitychange={refreshShown} />

<!-- Online is lime, offline stays neutral: no signal underground is normal. Only
     missing offline files are a problem, so only that line turns red. -->
<footer class="mt-4 flex min-h-44 flex-wrap items-center justify-between gap-x-12 gap-y-4 rounded-lg border border-line px-16 py-8 text-small text-muted">
  {#snippet side(icon: string, dot?: "ready" | "")}
    <span class="relative grid flex-none place-items-center text-c [&>svg]:size-16"><Icon svg={icon} />{#if dot !== undefined}<span
      aria-hidden="true" class={[dotClass(dot), "animate-none!"]}></span>{/if}</span>
  {/snippet}
  <!-- A ready update turns lime and the whole zone blinks until installed. -->
  <button type="button" id="app-update-status" data-state={updateReady ? "ready" : ""} onclick={onupdate}
    class={["flex min-w-0 items-center gap-8 bg-transparent p-0 text-left", updateReady ? "animate-pulse [--c:var(--neon-add)]" : "[--c:var(--neon-view)]"]}>
    {@render side(icons.update, updateReady ? "ready" : "")}
    <span><strong class={["font-normal tabular-nums", updateReady && "text-neon-add"]}
      >{#if updateReady}<span id="update-ready">{t("Update ready")}</span>{:else}<time id="app-updated-at"
        datetime={built?.toISOString()} title={built && new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(built)}
        >{built ? `${pad(built.getDate())}/${pad(built.getMonth() + 1)} ${pad(built.getHours())}:${pad(built.getMinutes())}`
          : import.meta.env.DEV ? t("Development") : t("Unknown")}</time>{/if}</strong>
      <!-- The icon says "last update"; a ready update says so itself. -->
      <small id="update-hint" class="hidden">{updateReady ? t("Tap to install") : t("Last update")}</small></span>
  </button>
  <div id="internet-status" role="status" aria-live="polite" data-state={reachable === undefined ? "checking" : reachable ? "available" : "idle"}
    title={reachable === false ? online ? t("Connected, but Mega Maps can't be reached") : t("No internet") : ""}
    class={["ml-auto flex min-w-0 items-center gap-8", reachable ? "[--c:var(--neon-add)]" : "[--c:var(--muted)]"]}>
    {@render side(reachable === false ? icons.noInternet : icons.online)}
    <span><strong class="font-normal tabular-nums">{reachable === undefined ? t("Checking…") : reachable ? t("Online") : t("Offline")}</strong>
      <!-- A plane marks the offline line: lime when ready, red when files are missing. -->
      <small class={["ml-8 inline-flex items-center gap-4 align-bottom [&>svg]:size-14", offlineReady === false && "text-danger",
        offlineReady && "[&>svg]:text-neon-add"]}><Icon svg={icons.offlineReady} /><span id="offline-availability"
          data-state={offlineReady === undefined ? undefined : offlineReady ? "available" : "unavailable"}
          >{offlineReady === undefined ? t("Offline use") : offlineReady ? t("Offline ready") : t("Not saved offline")}</span></small></span>
  </div>
</footer>
