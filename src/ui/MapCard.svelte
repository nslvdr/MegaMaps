<script lang="ts">
  import { locale, t } from "../i18n";
  import type { MapRecord } from "../types";
  import { loadNavigation } from "../storage/navigation";
  import { photoBytes } from "../storage/photos";
  import { displayName, formatBytes, lastUsed, plural } from "./format";
  import { icons } from "./icons";
  import { darkFilter, shownFilters, thumbnail } from "./thumbnails";
  import type { SheetIcon } from "./ActionSheet.svelte";
  import Icon from "./kit/Icon.svelte";

  // One map in the library: its preview edge to edge down the left, then what's
  // saved on it, when it was last used and what it takes on the device.
  let { map, saving, open, more }: {
    map: MapRecord;
    /** Leaving a map may still be writing its last edits. */
    saving: () => Promise<unknown>;
    open: (map: MapRecord) => void;
    /** Its ⋯ actions, about what it takes on the device and shown with its preview. */
    more: (map: MapRecord, detail: string, icon: SheetIcon) => void;
  } = $props();

  const name = $derived(displayName(map.name));
  let photos = $state(0), saved = $state<{ places: number; routes: number }>();
  // A preview shown before keeps its look at once, so coming home doesn't
  // flash placeholders while the map's settings are read again.
  let preview = $state<{ src: string; filter: string }>(), unavailable = $state(false);

  $effect(() => {
    const shown = map;
    let current = true;
    void photoBytes(shown.id).then((bytes) => { if (current) photos = bytes; }, () => {});
    const navigation = saving().catch(() => {}).then(() => loadNavigation(shown.id));
    void navigation.then(({ markers, routes }) => {
      if (current) saved = { places: markers.length, routes: routes.length };
    }, () => {});
    void thumbnail(shown).then(async (src) => {
      const known = shownFilters.get(shown.id);
      if (current && known !== undefined) preview = { src, filter: known };
      const inverted = await navigation.then((state) => state.inverted, () => false);
      const filter = inverted ? await darkFilter(shown.id, src) : "";
      if (!current) return;
      shownFilters.set(shown.id, filter);
      preview = { src, filter };
    }, () => { if (current) unavailable = true; });
    return () => { current = false; };
  });

  // The original is only part of it: tiles cut from it and photos weigh too.
  const storage = $derived([
    t("Image {size}", { size: formatBytes(map.bytes) }), t("Tiles {size}", { size: formatBytes(map.tileBytes ?? 0) }),
    ...photos ? [t("Photos {size}", { size: formatBytes(photos) })] : [],
  ].join(" · "));
  const counts = $derived(saved && ([
    [saved.places, "place", icons.pin, "text-kind-place"],
    [saved.routes, "route", icons.route, "text-kind-route"],
  ] as const).filter(([count]) => count));
</script>

<article data-map={map.id}
  class="flex min-h-104 items-stretch gap-4 overflow-hidden rounded-lg border border-neon-saved/22 bg-black pr-4">
  <button type="button" onclick={() => open(map)}
    class="flex min-w-0 flex-1 items-stretch gap-12 bg-transparent p-0 text-left enabled:active:scale-100 enabled:active:bg-white/3">
    <!-- The preview stays square: as tall as it is wide. -->
    <div class="relative w-104 shrink-0 overflow-hidden border-r border-line bg-panel">
      {#if preview}
        <!-- A dragged preview would carry its image as a file, and dropped back on the library it would import as a new map. -->
        <img src={preview.src} alt="" loading="lazy" draggable="false" style:filter={preview.filter || undefined}
          class="absolute inset-0 z-1 size-full object-cover" />
      {/if}
      <span class="absolute inset-0 grid place-items-center text-center text-small text-muted [&>svg]:size-28"
        >{#if unavailable}{t("Preview unavailable")}{:else}<Icon svg={icons.map} />{/if}</span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col justify-center py-12">
      <h3 class="m-0 mb-4 truncate text-body font-semibold">{name}</h3>
      <!-- What's saved reads first and brighter; places and routes lead with their map colors. -->
      {#if counts?.length}
        <p class="m-0 flex flex-wrap gap-x-12 text-small text-text/82">
          {#each counts as [count, word, icon, color] (word)}
            <span title={plural(count, word)} aria-label={plural(count, word)}
              class="flex items-center gap-4 whitespace-nowrap [&>svg]:size-14"><Icon svg={icon} class={color} />{count.toLocaleString(locale)}</span>
          {/each}
        </p>
      {:else}
        <p class="m-0 text-small text-muted">{counts ? t("Nothing saved yet") : " "}</p>
      {/if}
      <!-- When it was last used (the list's order), with what it takes on the right; on narrow screens the size wraps under. -->
      <p class="m-0 mt-4 flex flex-wrap gap-x-8 text-small text-muted tabular-nums">
        <span class="whitespace-nowrap">{lastUsed(map)}</span>
        <span class="ml-auto flex items-center gap-4 whitespace-nowrap [&>svg]:size-14"
          ><Icon svg={icons.storage} />{formatBytes(map.bytes + (map.tileBytes ?? 0) + photos)}</span>
      </p>
    </div>
  </button>
  <button type="button" aria-haspopup="dialog" title={t("Map options")} aria-label={t("Options for {name}", { name })}
    onclick={() => more(map, storage, preview ?? icons.map)}
    class="grid size-44 shrink-0 place-items-center self-center rounded-full bg-transparent text-muted hover:tint-neon-saved/12
      hover:text-neon-saved active:tint-neon-saved/12 active:text-neon-saved [&>svg]:size-20"><Icon svg={icons.more} /></button>
</article>
