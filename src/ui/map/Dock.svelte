<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { overMap } from "./styles";

  // The bottom pill: Saved · Search · Trail · Measure · Add. Saved and Add are
  // solid neon buttons; Search, Trail and Measure share the room between them,
  // tinted a step below. During a trip, Search and Measure turn round and Trail
  // shows the time since it started. A task's card, the search bar or an open
  // panel takes the pill's place, so each gets the room the pill held.
  let { controls }: { controls: ViewerControls } = $props();

  const editing = $derived(controls.tool !== "browse");
  const measuring = $derived(controls.tool === "measure" || controls.tool === "scale");
  const clock = $derived((controls.tick, controls.clockNow, controls.tripClock()));
  const button = "min-w-0 place-items-center p-8 disabled:opacity-35";
  const round = "grid size-44 flex-none rounded-full";
  const solid = [button, round, "bg-c text-black enabled:hover:bg-[color-mix(in_srgb,var(--c)_85%,#fff)] enabled:active:bg-[color-mix(in_srgb,var(--c)_75%,#fff)]"];
  const tinted = (shape: string) => [button, shape, "tint-c/14 inset-ring inset-ring-c/45 enabled:active:tint-c/24"];
  const pill = "grid h-44 flex-1 rounded-pill";
</script>

<nav id="dock" aria-label={t("Map menu")} hidden={editing || !!controls.openSheet}
  class={[overMap, "motion bottom-(--hud-bottom) z-5 flex h-(--dock-h) justify-between gap-8 rounded-lg border border-glass-line bg-black p-4 shadow-glass"]}>
  <button type="button" id="open-saved" aria-label={t("Saved")} title={t("Saved")} aria-controls="sheet" aria-expanded={controls.openSheet === "saved"}
    disabled={editing} onclick={() => controls.toggleSheet("saved")} class={[solid, "[--c:var(--neon-saved)]"]}
    ><Icon svg={icons.saved} class="size-full" /></button>
  <button type="button" id="open-search" aria-label={t("Search")} title={t("Search")} aria-controls="search-field" aria-expanded={controls.openSheet === "search"}
    disabled={editing} onclick={() => controls.openSearch()} class={[tinted(clock ? round : pill), "[--c:var(--neon-saved)]"]}
    ><Icon svg={icons.search} class={clock ? "size-full text-c" : "h-full w-28 text-c"} /></button>
  <button type="button" id="open-trail" aria-label={t("Trail")} title={t("Trail")} aria-controls="sheet" aria-expanded={controls.openSheet === "trail"}
    disabled={editing} onclick={() => controls.toggleSheet("trail")}
    class={[tinted(clock ? "flex h-44 flex-1 justify-center gap-8 rounded-pill" : pill), "[--c:var(--neon-trail)]"]}
    ><Icon svg={icons.trail} class="h-full w-28 flex-none text-c" />{#if clock}<span id="trip-clock"
      class="text-body font-bold whitespace-nowrap text-c tabular-nums">{clock}</span>{/if}</button>
  <button type="button" id="open-measure" aria-label={t("Measure")} title={t("Measure")} aria-pressed={measuring}
    disabled={editing && !measuring} onclick={() => controls.toggleMeasure()} class={[tinted(clock ? round : pill), "[--c:var(--neon-measure)]"]}
    ><Icon svg={icons.measure} class={clock ? "size-full text-c" : "h-full w-28 text-c"} /></button>
  <button type="button" id="open-add" aria-label={t("Add")} title={t("Add")} aria-controls="sheet" aria-expanded={controls.openSheet === "add"}
    disabled={editing} onclick={() => controls.toggleSheet("add")} class={[solid, "[--c:var(--neon-add)]"]}
    ><Icon svg={icons.add} class="size-full" /></button>
</nav>
