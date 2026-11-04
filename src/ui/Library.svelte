<script lang="ts">
  import { t } from "../i18n";
  import type { MapRecord } from "../types";
  import { app } from "./app-state.svelte";
  import { icons } from "./icons";
  import type { SheetIcon } from "./ActionSheet.svelte";
  import Button from "./kit/Button.svelte";
  import Icon from "./kit/Icon.svelte";
  import { dotClass } from "./kit/Row.svelte";
  import TopEdge from "./kit/TopEdge.svelte";
  import LibraryFooter from "./LibraryFooter.svelte";
  import MapCard from "./MapCard.svelte";

  // The library: your maps, the way to import more, and the app's state at the foot.
  let { dev = false, saving, open, more, openSettings, openImport, importFile, canDrop, answerExample, findUpdate, onupdate }: {
    /** Dev builds say so in the title. */
    dev?: boolean;
    /** Leaving a map may still be writing its last edits. */
    saving: () => Promise<unknown>;
    open: (map: MapRecord) => void;
    more: (map: MapRecord, detail: string, icon: SheetIcon) => void;
    openSettings: () => void;
    openImport: () => void;
    /** A map or .megamap file dropped on the library imports like Import. */
    importFile: (file: File) => void;
    canDrop: () => boolean;
    /** Removing the example goes through the usual delete; keeping it just hides the offer. */
    answerExample: (remove: boolean) => void;
    findUpdate?: () => Promise<boolean>;
    onupdate: () => void;
  } = $props();

  let footer: LibraryFooter;
  /** Checks the connection and for updates again. */
  export const refreshFooter = () => footer.refresh();

  const shown = $derived(app.page === "home");
  // Until there's a map of their own, the example doesn't stand in for one:
  // the invitation to import stays below it.
  const onlyExample = $derived(app.maps.length > 0 && app.maps.every((map) => map.example));

  // A file dragged over the library lights Import, where it will go.
  let dropping = $state(false);
  const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
  function dragover(event: DragEvent) {
    if (!carriesFiles(event)) return;
    const accepted = canDrop();
    event.dataTransfer!.dropEffect = accepted ? "copy" : "none";
    dropping = accepted;
  }
  function dragleave(event: DragEvent) {
    if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) dropping = false;
  }
  function drop(event: DragEvent) {
    dropping = false;
    const file = event.dataTransfer?.files[0];
    if (file && canDrop()) importFile(file);
  }
</script>

<main id="home" hidden={!shown} ondragover={dragover} ondragleave={dragleave} ondrop={drop}
  class="[--accent:var(--neon-add)] mr-auto ml-(--surface-left) flex min-h-svh w-(--surface-width) flex-col pt-(--home-top)
    pb-[max(12px,calc(env(safe-area-inset-bottom)-12px))]">
  <TopEdge />
  <!-- The library rises in each time it shows. -->
  <div class="flex flex-1 animate-enter flex-col [--enter-from:translateY(12px)]">
    <header class="flex flex-wrap items-center justify-between gap-12">
      <div class="flex items-center gap-12">
        <img src="/icons/icon.svg" alt="" width="48" height="48" draggable="false" class="block size-48 shrink-0" />
        <h1 class="m-0 text-heading font-bold tracking-tighter">Mega Maps{#if dev}{" "}<span class="text-neon-lock">Dev</span>{/if}</h1>
      </div>
      <button type="button" id="settings-open" aria-label={t("Settings")} title={t("Settings")} data-state={app.backupDue ? "due" : ""}
        onclick={openSettings}
        class="relative grid size-44 place-items-center rounded-full border border-neon-view/40 bg-black text-neon-view
          enabled:active:tint-neon-view/18 enabled:hover:tint-neon-view/12 [&>svg]:size-20">
        <Icon svg={icons.settings} /><span aria-hidden="true" class={dotClass(app.backupDue ? "due" : "")}></span>
      </button>
    </header>

    <section aria-labelledby="library-title" class="mt-24 flex-1">
      <div class="mb-12 flex items-center justify-between gap-12">
        <h2 id="library-title" class="flex items-center gap-8 text-small font-semibold text-neon-saved">
          {t("Your maps")}
          <!-- A 0 beside the empty state says nothing it doesn't. -->
          <span id="map-count" hidden={!app.maps.length} class="rounded-pill tint-neon-saved/12 px-8 py-4 tabular-nums">{app.maps.length}</span>
        </h2>
        <!-- Import sits on the list's heading, beside what it adds to. -->
        <button type="button" id="import-open" onclick={openImport}
          class={["flex min-h-40 items-center gap-4 rounded-pill border pr-16 pl-12 text-small font-strong",
            "[&>svg]:size-18 [&>svg]:text-neon-add enabled:active:tint-neon-add/18 enabled:hover:border-neon-add/70",
            dropping ? "border-neon-add/70 tint-neon-add/18" : "border-neon-add/40 tint-neon-add/10"]}
          ><Icon svg={icons.plus} /><span>{t("Import")}</span></button>
      </div>
      <!-- Behind an open map the list is unseen; going home shows it afresh. -->
      {#if shown && app.maps.length}
        <div id="map-grid" class="grid gap-12">
          {#each app.maps as map (map.id)}<MapCard {map} {saving} {open} {more} />{/each}
        </div>
      {/if}
      {#if app.exampleOffer}
        <div id="example-done" class="mt-12 flex flex-wrap items-center gap-8 rounded-lg border border-line p-12 [&>button]:flex-1">
          <p class="m-0 flex-[1_1_100%] text-small text-muted">{t("Done with the example map?")}</p>
          <Button id="example-keep" variant="quiet" label={t("Keep it")} onclick={() => answerExample(false)} />
          <Button id="example-remove" variant="quiet-danger" icon={icons.trash} label={t("Remove it")} onclick={() => answerExample(true)} />
        </div>
      {/if}
      {#if !app.maps.length || onlyExample}
        <!-- The whole card is a target too; Import stays the labelled control. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div id="empty" onclick={openImport}
          class={["cursor-pointer rounded-lg border px-20 py-32 text-center transition-colors duration-fast",
            "hover:border-neon-saved/50 hover:bg-neon-saved/5", app.maps.length && "mt-12",
            dropping ? "border-neon-saved/50 bg-neon-saved/5" : "border-neon-saved/22"]}>
          <span class="mx-auto mb-20 grid size-64 place-items-center rounded-full border border-neon-saved/35 text-neon-saved"><Icon svg={icons.map} /></span>
          <h3 id="empty-title" class="mt-0 mb-8 font-semibold">{onlyExample ? t("Now import your own map") : t("Your next route starts here")}</h3>
          <p class="m-0 text-small leading-relaxed text-muted">
            {t("Import a JPEG, PNG or WebP map, or a .megamap file from a friend.")}<br>{t("Keep it with you, even offline.")}
          </p>
          <p class="mt-12 mb-0 hidden text-small leading-relaxed text-muted [@media(hover:hover)_and_(pointer:fine)]:block">{t("You can also drop or paste one here.")}</p>
        </div>
      {/if}
    </section>

    <LibraryFooter bind:this={footer} {shown} {findUpdate} {onupdate} />
  </div>
</main>
