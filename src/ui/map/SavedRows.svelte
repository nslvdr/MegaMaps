<script lang="ts">
  import { t } from "../../i18n";
  import { plural } from "../format";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { RowItem, ViewerControls } from "../viewer-controls.svelte";

  // One black group per section, outlined in that section's colour (--k).
  // Rows open their item; ⋯ keeps its full 44px target and opens its actions.
  let { controls, id, labelledby, rows, empty, color }:
    { controls: ViewerControls; id: string; labelledby: string; rows: RowItem[]; empty: string; color: string } = $props();
</script>

<ul {id} aria-labelledby={labelledby} style:--k={color} class="m-0 list-none rounded-md border border-k/32 bg-black p-0 [&>*+*]:border-t [&>*+*]:border-k/14">
  {#each rows as row (row.key)}
    {@const photos = row.photos?.length ?? 0}
    <li data-row={row.key}>
      <div class="flex min-h-48 items-center gap-12 py-4 pr-4 pl-12">
        <button type="button" onclick={() => controls.jumpRow(row)}
          class="flex min-h-44 min-w-0 flex-1 items-center gap-12 bg-transparent p-0 text-left enabled:active:scale-100 enabled:active:opacity-70">
          <!-- Just the item's own icon, as on the map, with nothing around it. -->
          <span class="grid size-28 shrink-0 place-items-center text-c [&>svg]:size-26 [&>.place-icon]:size-28"><Icon svg={row.icon} /></span>
          <span class="flex min-w-0 flex-1 flex-col">
            <strong title={row.label} class="truncate text-body leading-tight font-semibold">{row.label}</strong>
            <!-- One line under the name: a route's points, the photo count, then the description. -->
            {#if row.meta || photos || row.description}
              <small data-detail class="truncate text-small leading-snug text-muted"
                >{row.meta ?? ""}{row.meta && (photos || row.description) ? " · " : ""}{#if photos}<span data-photos role="img"
                  aria-label={plural(photos, "photo")} class="inline-flex items-center gap-4 align-top tabular-nums"
                  ><Icon svg={icons.photos} class="size-15" />{photos}</span>{row.description ? " · " : ""}{/if}{row.description ?? ""}</small>
            {/if}
          </span>
        </button>
        <button type="button" data-menu aria-label={t("Actions for {name}", { name: row.label })} aria-haspopup="dialog" onclick={() => controls.openRow(row)}
          class="grid size-44 shrink-0 place-items-center rounded-full bg-transparent p-0 text-muted hover:bg-white/7 hover:text-text"
          ><Icon svg={icons.more} class="size-20" /></button>
      </div>
    </li>
  {:else}
    <!-- Empty lists keep a short status message. -->
    <li data-empty class="m-0 px-12 py-16 text-small leading-normal text-muted">{empty}</li>
  {/each}
</ul>
