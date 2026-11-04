<script lang="ts">
  import { language, t } from "../i18n";
  import { setPreference } from "../preferences";
  import { showDialog } from "./dialog";
  import { icons } from "./icons";
  import { fakePlan } from "./landing-map";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Row from "./kit/Row.svelte";
  import Rows from "./kit/Rows.svelte";

  // A browser tab only says what Mega Maps is and offers to install it; its
  // Install opens steps for this phone, acted out by a phone that taps through them.
  let { browser = navigator, events = window, host = location.host }:
    { browser?: Browser; events?: EventTarget; host?: string } = $props();

  let dialog: HTMLDialogElement;
  const apple = $derived(isApple(browser));
  let prompt = $state.raw<InstallPrompt>();
  let installed = $state(false);
  let step = $state(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const manual = $derived(!prompt && !installed);
  // The demo's parts: its browser bar and icons, menu rows, and a ring that
  // taps whatever the current step touches.
  const bar = "absolute inset-x-0 z-1 flex items-center gap-4 bg-[#1a1a1a] p-8";
  const icon = "grid size-32 flex-none place-items-center rounded-full [&>svg]:size-18";
  const row = "relative flex items-center gap-8 rounded-sm px-12 py-8 whitespace-nowrap [&>svg]:size-18";
  const ring = (at: number) => ["relative after:pointer-events-none after:absolute after:-inset-3 after:rounded-[inherit] after:border-2",
    "after:border-neon-add after:opacity-0", step === at && "after:animate-tap"];

  // Imports made in a tab stay in the tab, so every path ends in the app.
  const entry = (icon: string, label: string, hint: string): [string, string, string] => [icon, label, hint];
  const steps = $derived([
    ...manual
      ? apple
        ? [entry(icons.shareApple, t("Tap Share"), t("At the bottom of Safari, or in its ••• menu")),
          entry(icons.addToHome, t("Choose Add to Home Screen"), t("Scroll down the list if you don’t see it"))]
        : [entry(icons.browserMenu, t("Open the browser menu"), t("Next to the address bar")),
          entry(icons.download, t("Choose Install app"), t("Or Add to Home screen"))]
      : [],
    entry(icons.phone, t("Open Mega Maps from your home screen"), t("Import your maps there, not in the browser")),
  ]);

  const play = () => {
    clearInterval(timer);
    timer = setInterval(() => (step = (step + 1) % 3), STEP_TIME);
  };
  // Tapping a step shows it, then the demo carries on from there.
  function show(index: number) {
    if (!manual) return;
    step = index;
    play();
  }
  function open() {
    step = 0;
    play();
    showDialog(dialog);
  }
  // The sheet opens once; if dismissed, the manual steps take over.
  function installNow() {
    const shown = prompt;
    prompt = undefined;
    step = 0;
    void shown?.prompt().catch(() => {});
  }

  $effect(() => {
    const offered = (event: Event) => {
      event.preventDefault();
      prompt = event as InstallPrompt;
    };
    const done = () => {
      prompt = undefined;
      installed = true;
    };
    events.addEventListener("beforeinstallprompt", offered);
    events.addEventListener("appinstalled", done);
    return () => {
      events.removeEventListener("beforeinstallprompt", offered);
      events.removeEventListener("appinstalled", done);
      clearInterval(timer);
    };
  });
</script>

<script module lang="ts">
  type Browser = Pick<Navigator, "userAgent" | "maxTouchPoints"> & { standalone?: boolean };
  /** Chrome's own install sheet, offered once the app is installable. */
  type InstallPrompt = Event & { prompt(): Promise<void> };
  const STEP_TIME = 2600;

  /** Opened from the home screen, not in a browser tab. iOS also reports it on navigator. */
  export function isInstalled(view: Pick<Window, "matchMedia"> & { navigator: Browser } = window) {
    return view.navigator.standalone === true || view.matchMedia("(display-mode: standalone)").matches;
  }

  // iPadOS calls itself a Mac; only its touch screen tells it apart.
  export const isApple = ({ userAgent, maxTouchPoints }: Browser) =>
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
</script>

{#snippet logo(size: number)}<img src="/icons/icon.svg" alt="" width={size} height={size} draggable="false" class="rounded-sm" />{/snippet}
{#snippet page()}
  <div class="absolute inset-0 grid place-content-center justify-items-center gap-8 font-bold">{@render logo(56)}<span>Mega Maps</span></div>
{/snippet}
{#snippet address()}
  <span class="min-w-0 flex-1 truncate rounded-pill bg-[#2a2a2a] px-12 py-4 text-center text-muted">{host}</span>
{/snippet}

<section id="install" aria-labelledby="landing-title"
  class="fixed inset-0 flex flex-col items-center px-20 pt-[env(safe-area-inset-top)] pb-[max(20px,env(safe-area-inset-bottom))]">
  <!-- Drawn only here: an installed app never shows this page. -->
  {@html fakePlan()}
  <!-- Styled like a map label, since it sits on the plan. -->
  <button type="button" id="landing-language" onclick={() => { setPreference("language", language === "fr" ? "en" : "fr"); location.reload(); }}
    class="mt-8 min-h-36 self-end rounded-sm border border-[#445354] bg-[#080c0c] px-12 text-small text-text"
    >{language === "fr" ? "English" : "Français"}</button>
  <div class="flex max-w-280 flex-1 flex-col items-center justify-center gap-12 text-center">
    <img src="/icons/icon.svg" alt="" width="88" height="88" draggable="false" class="mb-4" />
    <h1 id="landing-title" class="m-0 text-heading font-black tracking-tight">Mega Maps</h1>
    <p class="m-0 leading-normal text-muted">{t("A reader for underground plans that works offline.")}</p>
    <!-- What it does, before asking to install it. -->
    <ul class="mt-8 grid list-none gap-8 p-0 text-left">
      {#each [[icons.map, t("Huge scans, smooth with no signal")], [icons.pin, t("Your places, routes and trail on the plan")],
        [icons.search, t("Search the names printed on the map")]] as [svg, text] (text)}
        <li class="flex items-center gap-12"><Icon svg={svg!} class="size-20 flex-none text-neon-saved" /><span>{text}</span></li>
      {/each}
    </ul>
  </div>
  <Button id="install-open" icon={icons.download} label={t("Install")} onclick={open}
    class="min-h-56! w-[min(100%,var(--surface-max-width))] rounded-pill!" />
</section>

<dialog bind:this={dialog} id="install-dialog" aria-labelledby="install-title" onclose={() => clearInterval(timer)}>
  <DialogHeader id="install-title" title={t("Install Mega Maps")} icon={icons.download} close={{ id: "install-close", onclick: () => dialog.close() }} />
  <p>{t("Three taps, and Mega Maps lives on your home screen, full screen and offline.")}</p>
  <Button id="install-now" icon={icons.download} label={t("Install now")} hidden={!prompt} onclick={installNow} class="mt-16 w-full" />
  <!-- A phone acting out the steps: the browser, its install menu, then the home screen. -->
  <div id="install-demo" data-step={step} aria-hidden="true" hidden={!manual} class="mt-16 flex justify-center">
    <div class="relative h-310 w-232 overflow-hidden rounded-[34px] border-6 border-[#151515] bg-[#0a0a0a] text-small shadow-[0_0_0_1px_#ffffff26]">
      {#if apple}
        {@render page()}
        <div class={[bar, "bottom-0 pb-16"]}>
          <span class={icon}><Icon svg={icons.arrow} /></span>{@render address()}
          <span class={[icon, ring(0)]}><Icon svg={icons.shareApple} /></span>
        </div>
        <div class={["absolute inset-x-0 bottom-0 z-2 grid gap-8 rounded-t-md bg-[#1c1c1e] px-8 pt-16 pb-20 transition-transform duration-base ease-out",
          step !== 1 && "translate-y-[105%]"]}>
          <span class={[row, "bg-[#2c2c2e]"]}><Icon svg={icons.copy} /><span>{t("Copy")}</span></span>
          <span class={[row, "bg-[#2c2c2e]", ring(1)]}><Icon svg={icons.addToHome} /><span>{t("Add to Home Screen")}</span></span>
        </div>
      {:else}
        <div class={[bar, "top-0 pt-12"]}>{@render address()}<span class={[icon, ring(0)]}><Icon svg={icons.browserMenu} /></span></div>
        {@render page()}
        <div class={["absolute top-52 right-4 z-2 grid origin-top-right gap-4 rounded-sm bg-[#202124] p-4 shadow-[0_8px_24px_#000a]",
          "transition-[opacity,transform] duration-base ease-out", step !== 1 && "scale-85 opacity-0"]}>
          <span class={row}><Icon svg={icons.plus} /><span>{t("New tab")}</span></span>
          <span class={[row, ring(1)]}><Icon svg={icons.download} /><span>{t("Install app")}</span></span>
        </div>
      {/if}
      <div class={["absolute inset-0 z-3 grid grid-cols-[repeat(3,48px)] place-content-center gap-x-20 gap-y-32",
        "bg-[linear-gradient(160deg,#0f2430,#000)] transition-opacity duration-base ease-out", step !== 2 && "opacity-0"]}>
        {#each { length: 4 }, index (index)}<span class="size-48 rounded-sm bg-white/8"></span>{/each}
        <span class={["relative grid justify-items-center rounded-sm transition-[opacity,transform] delay-(--motion-fast) duration-base ease-out",
          step !== 2 && "scale-60 opacity-0", ring(2)]}>{@render logo(48)}<span class="absolute top-[calc(100%+4px)] whitespace-nowrap">Mega Maps</span></span>
        {#each { length: 4 }, index (index)}<span class="size-48 rounded-sm bg-white/8"></span>{/each}
      </div>
    </div>
  </div>
  <Rows tag="ol" id="install-steps" class="list-none p-0">
    {#each steps as [svg, label, hint], index (label)}
      {@const current = manual && index === step}
      <Row tag="li" icon={svg} {label} {hint} tone={!manual || current ? "var(--neon-add)" : "var(--muted)"} {current}
        onclick={() => show(index)} class={["transition-colors duration-fast", manual && "cursor-pointer", current && "bg-neon-add/8"]} />
    {/each}
  </Rows>
  <p id="install-note" class="my-16 text-small leading-roomy">{installed
    ? t("Installed. Open Mega Maps from your home screen to import your maps.")
    : apple ? t("On iPhone and iPad, Safari and the app don’t share maps.") : ""}</p>
</dialog>
