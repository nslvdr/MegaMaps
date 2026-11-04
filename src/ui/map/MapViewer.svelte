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
</script>

<!-- The map fades up from black as it opens. -->
<section id="viewer" aria-label={t("Map viewer")} {hidden} data-tool={controls?.tool ?? "browse"}
  class="fixed inset-0 z-10 animate-enter overscroll-none bg-black text-body select-none
    [--c:var(--accent)] [--dock-h:54px] [--tool-row-h:64px]
    [--hud-top:max(12px,calc(env(safe-area-inset-top)+2px))]
    [--hud-bottom:max(12px,calc(env(safe-area-inset-bottom)-12px))]">
  <!-- The map is the only filtered raster surface. All tools stay in screen space. -->
  <div id="map-stage" class="absolute inset-0 overflow-hidden rounded-t-sm bg-black">
    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas id="map-canvas" role="img" class="block size-full touch-none"
      aria-label={t("Map: drag to pan; pinch or double-tap and drag to zoom, two-finger tap to zoom out; long-press, then drag up-left to add a place, up-right to go back to your last mark, or down to mark where you are.")}></canvas>
    <svg id="search-overlay" aria-hidden="true" class="pointer-events-none absolute inset-0 z-1 size-full overflow-hidden"></svg>
    <svg id="map-overlay" aria-hidden="true"
      class="map-overlay pointer-events-none absolute inset-0 size-full overflow-hidden transition-[filter] duration-slow ease-out"></svg>
    {#if controls}<HoldWheel wheel={controls.wheel} />{/if}
  </div>
  <button type="button" id="back" aria-label={t("Back to library")} title={t("Back to library")} onclick={back}
    class="absolute top-(--hud-top) left-(--edge-l) z-2 grid size-44 place-items-center rounded-full border border-glass-line bg-black p-0
      shadow-glass enabled:hover:border-c/50 enabled:hover:tint-c/18 enabled:active:tint-c/22"><Icon svg={icons.arrow} class="size-20" /></button>
  {#if controls}<MapControls {controls} />{/if}
</section>
