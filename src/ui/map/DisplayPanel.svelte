<script lang="ts">
  import { t } from "../../i18n";
  import { plural } from "../format";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import Switch from "../kit/Switch.svelte";
  import { BRIGHTNESS_LEVELS, brightnessPercent, layerNames } from "../../viewer/navigation";
  import type { ViewerControls } from "../viewer-controls.svelte";

  // View settings as tiles: Dark map, Brightness, a tile per layer saying
  // whether it shows, and Scale and north with its two ways to set it.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const view = $derived.by(() => {
    controls.tick;
    const state = controls.state;
    return { inverted: state.inverted, dimming: state.dimming, layers: { ...state.layers, streets: !!state.streets },
      status: controls.darkStatus(), counts: { routes: state.routes.length, places: state.markers.length }, streets: controls.streetsView() };
  });
  // Streets only become a layer once the map is lined up with them.
  const tiles = $derived([...layerNames, ...(view.streets.placed ? ["streets" as const] : [])]);
  const layers = {
    routes: { label: t("Routes"), icon: icons.route, neon: "[--k:var(--kind-route)]", id: "layer-routes" },
    places: { label: t("Places"), icon: icons.pin, neon: "[--k:var(--kind-place)]", id: "layer-places" },
    labels: { label: t("Names"), icon: icons.text, neon: "[--k:var(--neon-saved)]", id: "layer-labels" },
    streets: { label: t("Streets"), icon: icons.map, neon: "[--k:var(--neon-add)]", id: "streets" },
  };
  function toggle(layer: (typeof tiles)[number], on: boolean) {
    if (layer === "streets") controls.setStreets(on);
    else controls.setLayer(layer, on);
  }
  const hint = (layer: (typeof tiles)[number]) => !view.layers[layer] ? t("Hidden")
    : layer === "routes" ? plural(view.counts.routes, "route") : layer === "places" ? plural(view.counts.places, "place") : t("Visible");

  // Brightness reads dim to bright, left to right. Each step is a native radio
  // under its fifth of the track; sliding a finger along picks the step under it.
  const steps = [...BRIGHTNESS_LEVELS].reverse();
  const at = $derived(Math.max(0, steps.findIndex((level) => level === view.dimming)));
  const centre = (index: number) => `${index * 20 + 10}%`;
  function slide(event: PointerEvent) {
    if (!event.buttons) return;
    const box = event.currentTarget instanceof HTMLElement && event.currentTarget.getBoundingClientRect();
    if (!box) return;
    const level = steps[Math.min(steps.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * steps.length)))];
    if (level !== undefined && level !== view.dimming) controls.setBrightness(level);
  }

  // A tile wears its --k neon when on; off, it greys. Its icon sits in a circle.
  const tile = (on = false) => ["rounded-md border", on ? "border-k/45 tint-k/12" : "border-glass-line bg-fill"];
  const tileIcon = (on: boolean) => ["grid size-34 shrink-0 place-items-center rounded-full [&>svg]:size-20", on ? "bg-k text-black" : "bg-fill-strong text-muted"];
  const softIcon = "grid size-34 shrink-0 place-items-center rounded-full bg-k/16 text-k [&>svg]:size-20";
  const tileText = "flex min-w-0 flex-1 flex-col [&>strong]:text-body [&>strong]:font-semibold [&>small]:text-small [&>small]:text-muted";
  // Native radios and switches keep a full-size touch target under the tile.
  const fill = "absolute inset-0 m-0 size-full cursor-pointer opacity-0";
  const setButton = "flex min-h-44 cursor-pointer items-center justify-center gap-8 rounded-sm border border-glass-line bg-fill px-8 text-center text-small font-semibold text-text";
</script>

<div id="sheet-display" {hidden} class="grid gap-8">
  <label class={[tile(view.inverted), "flex min-h-64 cursor-pointer items-center gap-12 px-12 py-8 [--k:var(--c)]"]}>
    <span class={tileIcon(view.inverted)}><Icon svg={icons.moon} /></span>
    <span class={tileText}><strong class="text-text">{t("Dark map")}</strong><small id="dark-status">{view.status}</small></span>
    <Switch id="dark-map" checked={view.inverted} onchange={() => controls.setDark(!view.inverted)} />
  </label>

  <div class={[tile(), "px-12 pt-8 pb-4 [--k:var(--c)]"]}>
    <div class="flex min-h-48 items-center gap-12">
      <span class={softIcon}><Icon svg={icons.sun} /></span>
      <span class={tileText}><strong>{t("Brightness")}</strong><small id="brightness-help">{t("Dim the map so routes and places stand out.")}</small></span>
      <span class="text-body font-semibold tabular-nums">{brightnessPercent(view.dimming)}%</span>
    </div>
    <div onpointerdown={slide} onpointermove={slide} role="radiogroup" tabindex="-1" aria-label={t("Map brightness")} aria-describedby="brightness-help"
      class="relative grid h-44 touch-pan-y grid-cols-5">
      <span aria-hidden="true" class="pointer-events-none absolute inset-x-[10%] top-1/2 h-6 -translate-y-1/2 rounded-pill bg-fill-strong"></span>
      <span aria-hidden="true" style:width="{at * 20}%"
        class="pointer-events-none absolute left-[10%] top-1/2 h-6 -translate-y-1/2 rounded-pill bg-c transition-[width] duration-fast"></span>
      {#each steps as level (level)}
        <label class="relative grid cursor-pointer place-items-center">
          <input type="radio" name="map-brightness" id="brightness-{brightnessPercent(level)}" value={level} checked={view.dimming === level}
            aria-label="{brightnessPercent(level)}%" onchange={() => controls.setBrightness(level)} class={fill} />
          <span aria-hidden="true" class="pointer-events-none h-12 w-4 rounded-pill bg-glass-line"></span>
        </label>
      {/each}
      <span aria-hidden="true" style:left={centre(at)}
        class="pointer-events-none absolute top-1/2 size-28 -translate-1/2 rounded-full bg-white shadow-menu transition-[left] duration-fast"></span>
    </div>
  </div>

  <!-- A hidden layer reads as off at a glance: its tile greys and says so. -->
  <div role="group" aria-label={t("Show on map")} class="grid grid-cols-2 gap-8">
    {#each tiles as layer, index (layer)}
      <label class={[tile(view.layers[layer]), layers[layer].neon, "relative flex min-h-64 min-w-0 cursor-pointer items-center gap-10 px-12 py-8",
        "transition-colors duration-fast",
        index === tiles.length - 1 && tiles.length % 2 && "col-span-2"]}>
        <input type="checkbox" role="switch" id={layers[layer].id} aria-label={layers[layer].label} checked={view.layers[layer]}
          onchange={(event) => toggle(layer, event.currentTarget.checked)} class={fill} />
        <span class={tileIcon(view.layers[layer])}><Icon svg={layers[layer].icon} /></span>
        <span class={tileText}><strong class={view.layers[layer] ? "text-text" : "text-muted"}>{layers[layer].label}</strong>
          <small id="{layers[layer].id}-hint">{hint(layer)}</small></span>
      </label>
    {/each}
  </div>

  <!-- Scale and north: where they come from, and the two ways to set them. -->
  <div class={[tile(), "px-12 pt-8 pb-12 [--k:var(--neon-add)]"]}>
    <div class="flex min-h-48 items-center gap-12">
      <span class={softIcon}><Icon svg={icons.scale} /></span>
      <span class={tileText}><strong>{t("Scale and north")}</strong><small id="scale-status">{view.streets.scale}</small></span>
    </div>
    <div class="mt-8 grid grid-cols-2 gap-8">
      <button type="button" id="calibrate-streets" onclick={() => controls.calibrate()} class={setButton}>
        <Icon svg={icons.map} class="size-18 flex-none" />{view.streets.placed ? t("Adjust on streets") : t("Line up with streets")}</button>
      <button type="button" id="measure-length" onclick={() => controls.startScale("browse")} class={setButton}>
        <Icon svg={icons.scale} class="size-18 flex-none" />{t("Measure a length")}</button>
    </div>
  </div>
</div>
