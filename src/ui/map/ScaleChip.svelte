<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { overMap } from "./styles";

  // Above the pill's left end: the map's scale bar, sized to the zoom, or
  // "Set up map" on a map without a scale. Either opens Map setup, on the
  // settings once they're done.
  let { controls }: { controls: ViewerControls } = $props();
  const bar = $derived((controls.tick, controls.zoom, controls.scaleBarView()));
</script>

<div hidden={controls.tool !== "browse" || !!controls.openSheet}
  class={[overMap, "motion pointer-events-none bottom-[calc(var(--hud-bottom)+var(--dock-h)+8px)] z-5 flex"]}>
  <button type="button" id="scale-chip" aria-controls="sheet" onclick={() => controls.openSetup()}
    aria-label={bar ? t("Scale: {distance}. Map setup", { distance: bar.label }) : t("Set up map")}
    class={["pointer-events-auto flex h-36 items-center gap-10 rounded-pill border bg-black px-12 text-small font-semibold shadow-glass hit-5",
      bar ? "border-glass-line text-text" : "border-dashed border-neon-add text-neon-add"]}>
    {#if bar}
      <svg aria-hidden="true" style:width="{bar.width}px" class="block h-12 overflow-visible">
        <path d="M1 1v10h{bar.width - 2}V1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      </svg>
      <span id="scale-chip-label" class="tabular-nums">{bar.label}</span>
    {:else}
      <Icon svg={icons.scale} class="size-16" />{t("Set up map")}
    {/if}
  </button>
</div>
