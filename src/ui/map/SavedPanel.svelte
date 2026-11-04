<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { SectionMenu, ViewerControls } from "../viewer-controls.svelte";
  import SavedRows from "./SavedRows.svelte";
  import SectionTitle from "./SectionTitle.svelte";

  // Saved: routes, then places, each with its order and, for places, a filter
  // by type. Rows are built only while the panel shows.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  const counts = $derived((controls.tick, { routes: controls.state.routes.length, places: controls.state.markers.length }));
  const rows = $derived.by(() => {
    controls.tick;
    controls.confirming;
    return hidden ? { places: [], routes: [] } : controls.savedRows();
  });
</script>

<!-- A section's order and filter: a 44px target around the title's small ring. -->
{#snippet menu(id: SectionMenu, label: string, count: number, active = false)}
  {@const open = controls.rowMenu === id}
  <button type="button" {id} data-menu aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "saved-section-menu" : undefined}
    hidden={count < 2} onclick={() => controls.toggleMenu(id)} class="-my-8 -mr-8 grid size-44 place-items-center rounded-full bg-transparent p-0"
    ><Icon svg={icons.filter} class={["size-28 rounded-full p-6", open || active ? "text-k tint-k/14 inset-ring inset-ring-k/45"
      : "bg-black text-muted inset-ring inset-ring-line"].join(" ")} /></button>
{/snippet}

<div id="sheet-saved" {hidden}>
  <SectionTitle id="saved-routes-title" icon={icons.route} label={t("Routes")} count={String(counts.routes)} countId="saved-routes-count"
    color="var(--kind-route)" first>
    {@render menu("routes-order", t("Order routes"), counts.routes)}
  </SectionTitle>
  {#if !hidden}
    <SavedRows {controls} id="route-list" labelledby="saved-routes-title" rows={rows.routes} empty={t("No routes yet. Tap Add, then Route.")}
      color="var(--kind-route)" />
  {/if}
  <SectionTitle id="saved-places-title" icon={icons.pin} label={t("Places")} countId="saved-places-count" color="var(--kind-place)"
    count={controls.placeKinds.size ? `${rows.places.length}/${counts.places}` : String(counts.places)}>
    {@render menu("places-order", t("Order and filter places"), counts.places, controls.placeKinds.size > 0)}
  </SectionTitle>
  {#if !hidden}
    <SavedRows {controls} id="marker-list" labelledby="saved-places-title" rows={rows.places} empty={t("No places yet. Hold the map to add one.")}
      color="var(--kind-place)" />
  {/if}
</div>
