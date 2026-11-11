<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import HoldWheel from "./HoldWheel.svelte";
  import MapControls from "./MapControls.svelte";

  // The open map: its canvas and drawn layers, Back, and while a map is open
  // its controls. Map first: almost nothing floats over the map.
  let { controls, back, hidden }: { controls?: ViewerControls; back: () => void; hidden: boolean } = $props();
  // Matching spots, the map and the streets share the screen above the card,
  // each moved apart from the other. Lining up is one task: the card is the way out.
  const matching = $derived(controls?.tool === "match");
  const lining = $derived(matching || controls?.tool === "check");
</script>

{#snippet crossAndName(name: string)}
  <Icon svg={icons.pair} class="pointer-events-none absolute top-1/2 left-1/2 size-44 -translate-1/2 text-neon-add drop-shadow-[0_0_1px_#000]" />
  <span class="pointer-events-none absolute bottom-8 left-8 rounded-pill border border-glass-line bg-black px-8 py-2 text-small">{name}</span>
{/snippet}

<!-- The map fades up from black as it opens. -->
<section id="viewer" aria-label={t("Map viewer")} {hidden} data-tool={controls?.tool ?? "browse"} style:--match-card="{controls?.toolHeight ?? 0}px"
  class="fixed inset-0 z-10 animate-enter overscroll-none bg-black text-body select-none
    [--c:var(--accent)] [--dock-h:54px] [--tool-row-h:64px]
    [--match-pane:calc((100%-var(--match-card)-var(--hud-bottom)-12px)/2)]
    [--hud-top:max(12px,calc(env(safe-area-inset-top)+2px))]
    [--hud-bottom:max(12px,calc(env(safe-area-inset-bottom)-12px))]">
  <!-- The map is the only filtered raster surface. All tools stay in screen space. -->
  <div id="map-stage" class={["absolute inset-0 overflow-hidden rounded-t-sm bg-black", matching && "bottom-auto h-(--match-pane) border-b-2 border-black"]}>
    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas id="map-canvas" role="img" class="block size-full touch-none"
      aria-label={t("Map: drag to pan; pinch or double-tap and drag to zoom, two-finger tap to zoom out; long-press, then drag up-left to add a place, up-right to go back to your last mark, or down to mark where you are.")}></canvas>
    <svg id="search-overlay" aria-hidden="true" class="pointer-events-none absolute inset-0 z-1 size-full overflow-hidden"></svg>
    <svg id="map-overlay" aria-hidden="true"
      class="map-overlay pointer-events-none absolute inset-0 size-full overflow-hidden transition-[filter] duration-slow ease-out"></svg>
    {#if controls}<HoldWheel wheel={controls.wheel} />{/if}
    {#if matching}{@render crossAndName(t("Your map"))}{/if}
  </div>
  <!-- The part in sight above the card; the streets run on behind it to the screen's edge. -->
  <div id="street-pane" class={["absolute inset-x-0 top-(--match-pane) h-(--match-pane)", !matching && "hidden"]}>
    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas id="street-canvas" role="img" aria-label={t("Streets")}
      class="absolute top-0 left-0 block h-[calc(100%+var(--match-card)+var(--hud-bottom)+12px)] w-full touch-none"></canvas>
    {#if matching}{@render crossAndName(t("Streets"))}{/if}
  </div>
  <button type="button" id="back" hidden={lining} aria-label={t("Back to library")} title={t("Back to library")} onclick={back}
    class="absolute top-(--hud-top) left-(--edge-l) z-2 grid size-44 place-items-center rounded-full border border-glass-line bg-black p-0
      shadow-glass enabled:hover:border-c/50 enabled:hover:tint-c/18 enabled:active:tint-c/22"><Icon svg={icons.arrow} class="size-20" /></button>
  {#if controls}<MapControls {controls} />{/if}
</section>
