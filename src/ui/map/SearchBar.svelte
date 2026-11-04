<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { overMap } from "./styles";

  // Searching, the field takes the pill's place; its count sits above it, so
  // results never steal space from the query. Typing, it rides above the keyboard.
  let { controls }: { controls: ViewerControls } = $props();
  const search = $derived((controls.tick, controls.searchView()));
  const open = $derived(controls.openSheet === "search");
</script>

<div id="search-field" data-bar hidden={!open}
  class={[overMap, "motion bottom-(--hud-bottom) z-5 flex h-(--tool-row-h) items-center gap-12 rounded-pill border border-glass-line bg-black pr-16 pl-20",
    "shadow-glass [--c:var(--neon-saved)] focus-within:border-c/55"]}>
  <Icon svg={icons.search} class="size-24 shrink-0 text-c" />
  <input id="map-search" type="search" aria-label={t("Search map text and saved places")} aria-describedby="search-status"
    aria-controls="search-overlay" placeholder={t("Search map…")} autocomplete="off" autocapitalize="off"
    enterkeyhint="search" disabled={controls.tool !== "browse"} value={controls.query}
    oninput={(event) => { controls.query = event.currentTarget.value; controls.queueSearch(); }}
    onkeydown={(event) => controls.searchKey(event)}
    class="h-[calc(var(--tool-row-h)-12px)] w-full min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 text-body text-text
      placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none" />
  <!-- The count doubles as Next, so a touch screen can step through matches
       once Enter has put the keyboard away; it then shows where you are. -->
  <button type="button" id="search-count" title={t("Next match")} hidden={!search.active} disabled={!search.count} aria-label={search.label}
    onclick={() => controls.stepSearch()}
    class={["absolute right-0 bottom-[calc(100%+10px)] flex h-44 min-w-32 flex-none items-center justify-center gap-12 rounded-md border px-16",
      "text-small font-strong whitespace-nowrap tabular-nums",
      search.count
        ? "border-c/30 text-c tint-c/14 enabled:hover:tint-c/20 enabled:active:tint-c/24"
        : "border-transparent bg-[#171717] text-muted disabled:opacity-100"]}
    >{search.badge}{#if search.count}<Icon svg={icons.next} class="size-16" />{/if}</button>
  <button type="button" id="search-close" aria-label={t("Close search")} title={t("Close")} onclick={() => controls.sheet(undefined)}
    class="relative grid size-30 flex-none place-items-center rounded-full bg-fill-strong p-0 text-muted hit-7 hover:text-text active:text-text"
    ><Icon svg={icons.close} class="size-16" /></button>
</div>
<p id="search-status" role="status" aria-live="polite" class="sr-only">{search.status}</p>
