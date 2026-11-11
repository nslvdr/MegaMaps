<script lang="ts">
  import { t } from "../../i18n";
  import { plural } from "../format";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import Switch from "../kit/Switch.svelte";
  import BrightnessTile from "./BrightnessTile.svelte";
  import { BRIGHTNESS_LEVELS, layerNames, STREET_LEVELS, streetColors } from "../../viewer/navigation";
  import { streetSwatch } from "../../viewer/street-tiles";
  import type { ViewerControls } from "../viewer-controls.svelte";

  // View settings: Dark map for everything, then two sections alike, each a
  // Brightness slider over a row of three tiles: the map and its layers, and
  // the streets once the map is lined up with them.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const view = $derived.by(() => {
    controls.tick;
    const state = controls.state;
    return { inverted: state.inverted, dimming: state.dimming, layers: state.layers,
      street: { brightness: state.streetBrightness, color: state.streetColor, fade: state.streetFade },
      status: controls.darkStatus(), counts: { routes: state.routes.length, places: state.markers.length }, streets: controls.streetsView() };
  });
  const layers = {
    routes: { label: t("Routes"), icon: icons.route, neon: "[--k:var(--kind-route)]", id: "layer-routes" },
    places: { label: t("Places"), icon: icons.pin, neon: "[--k:var(--kind-place)]", id: "layer-places" },
    labels: { label: t("Names"), icon: icons.text, neon: "[--k:var(--neon-saved)]", id: "layer-labels" },
  };
  const hint = (layer: (typeof layerNames)[number]) => !view.layers[layer] ? t("Hidden")
    : layer === "routes" ? plural(view.counts.routes, "route") : layer === "places" ? plural(view.counts.places, "place") : t("Visible");
  const colorNames = { pink: t("Pink"), violet: t("Violet"), grey: t("Gray"), osm: t("Original") };

  // A tile wears its --k neon when on; off, it greys. Its icon sits in a circle.
  const tile = (on = false) => ["rounded-md border transition-[background-color,border-color,opacity] duration-fast",
    on ? "border-k/45 tint-k/12" : "border-glass-line bg-fill"];
  const tileIcon = (on: boolean) => ["grid size-34 shrink-0 place-items-center rounded-full [&>svg]:size-20", on ? "bg-k text-black" : "bg-fill-strong text-muted"];
  const tileText = "flex min-w-0 flex-col [&>strong]:text-body [&>strong]:font-semibold [&>strong]:leading-tight [&>small]:text-small [&>small]:text-muted";
  // A tile in a row of three: icon above its name and state.
  const small = "relative flex min-w-0 cursor-pointer flex-col items-start gap-8 px-12 py-10";
  // A section title, with its layer's icon.
  const heading = "mt-12 flex items-center gap-6 text-small font-strong tracking-caps text-muted uppercase [&>svg]:size-16";
  // Native radios and switches keep a full-size touch target under the tile.
  const fill = "absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-default";
</script>

<div id="sheet-display" {hidden} class="grid gap-8">
  <label class={[tile(view.inverted), "flex min-h-64 cursor-pointer items-center gap-12 px-12 py-8 [--k:var(--c)]"]}>
    <span class={tileIcon(view.inverted)}><Icon svg={icons.moon} /></span>
    <span class={[tileText, "flex-1"]}><strong class="text-text">{t("Dark map")}</strong><small id="dark-status">{view.status}</small></span>
    <Switch id="dark-map" checked={view.inverted} onchange={() => controls.setDark(!view.inverted)} />
  </label>

  <h3 class={heading}><Icon svg={icons.layers} />{t("Map layer")}</h3>
  <BrightnessTile name="brightness" label={t("Map brightness")} levels={BRIGHTNESS_LEVELS} value={view.dimming}
    onpick={(level) => controls.setBrightness(level)} />
  <!-- A hidden layer reads as off at a glance: its tile greys and says so. -->
  <div role="group" aria-label={t("Show on map")} class="grid grid-cols-3 gap-8">
    {#each layerNames as layer (layer)}
      <label class={[tile(view.layers[layer]), layers[layer].neon, small]}>
        <input type="checkbox" role="switch" id={layers[layer].id} aria-label={layers[layer].label} checked={view.layers[layer]}
          onchange={(event) => controls.setLayer(layer, event.currentTarget.checked)} class={fill} />
        <span class={tileIcon(view.layers[layer])}><Icon svg={layers[layer].icon} /></span>
        <span class={tileText}><strong class={view.layers[layer] ? "text-text" : "text-muted"}>{layers[layer].label}</strong>
          <small id="{layers[layer].id}-hint">{hint(layer)}</small></span>
      </label>
    {/each}
  </div>

  <!-- Streets only become a layer once the map is lined up with them. Hidden,
       their settings dim rather than go, so the panel keeps its shape. -->
  {#if view.streets.placed}
    {@const on = view.streets.on}
    {@const fades = view.street.fade && on}
    <h3 class={heading}><Icon svg={icons.map} />{t("Streets layer")}</h3>
    <div class="grid gap-8 [--c:var(--neon-add)] [--k:var(--neon-add)]">
      <BrightnessTile name="street-brightness" label={t("Street brightness")} levels={STREET_LEVELS} value={view.street.brightness}
        disabled={!on} onpick={(level) => controls.setStreetBrightness(level)} />
      <div class="grid grid-cols-3 gap-8">
        <label class={[tile(on), small]}>
          <input type="checkbox" role="switch" id="streets" aria-label={t("Streets")} checked={on}
            onchange={(event) => controls.setStreets(event.currentTarget.checked)} class={fill} />
          <span class={tileIcon(on)}><Icon svg={icons.map} /></span>
          <span class={tileText}><strong class={on ? "text-text" : "text-muted"}>{t("Streets")}</strong>
            <small id="streets-hint">{on ? t("Visible") : t("Hidden")}</small></span>
        </label>
        <label class={[tile(fades), small, !on && "opacity-40"]}>
          <input type="checkbox" role="switch" id="street-fade" aria-label={t("Zoom fade")} checked={view.street.fade} disabled={!on}
            onchange={(event) => controls.setStreetFade(event.currentTarget.checked)} class={fill} />
          <span class={tileIcon(fades)}><Icon svg={icons.zoomIn} /></span>
          <span class={tileText}><strong class={fades ? "text-text" : "text-muted"}>{t("Zoom fade")}</strong>
            <small>{view.street.fade ? t("On") : t("Off")}</small></span>
        </label>
        <div role="radiogroup" aria-label={t("Street color")}
          class={[tile(), "flex min-w-0 flex-col gap-6 px-12 py-10", !on && "opacity-40"]}>
          <strong class="text-body font-semibold leading-tight">{t("Color")}</strong>
          <div class="grid grid-cols-2 justify-items-center">
            {#each streetColors as color (color)}
              {@const picked = view.street.color === color}
              <label class="relative grid size-36 cursor-pointer place-items-center">
                <input type="radio" name="street-color" id="street-color-{color}" value={color} checked={picked} disabled={!on}
                  aria-label={colorNames[color]} onchange={() => controls.setStreetColor(color)} class={fill} />
                <span aria-hidden="true" style:background={streetSwatch(color)}
                  class={["size-28 rounded-full border-2 transition-colors duration-fast", picked ? "border-white" : "border-transparent"]}></span>
              </label>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
