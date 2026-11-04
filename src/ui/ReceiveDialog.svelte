<script lang="ts">
  import { showDialog } from "./dialog";
  import { displayName, plural } from "./format";
  import { icons } from "./icons";
  import { t, errorMessage } from "../i18n";
  import { tileKey, type MapRecord } from "../types";
  import { payloadStore } from "../storage/payloads";
  import { loadNavigation } from "../storage/navigation";
  import { readShare, type SharedMap } from "../sharing/format";
  import { matchingMaps, type ImportMode } from "../sharing/storage";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Row from "./kit/Row.svelte";
  import Rows from "./kit/Rows.svelte";

  // Says what a shared file holds and what importing it will do before anything is written.
  let { maps: listMaps, import: importShare, imported }: {
    maps: () => Promise<MapRecord[]>;
    import: (share: SharedMap, destination: ShareDestination) => Promise<ShareImportResult>;
    imported: (result: ShareImportResult, destination: ShareDestination) => Promise<void>;
  } = $props();

  let dialog: HTMLDialogElement, imageInput: HTMLInputElement;
  let summary = $state(""), loading = $state(false), failure = $state<string>();
  let received = $state.raw<SharedMap>();
  // Only maps made from the same image can take the shared places and routes.
  let maps = $state.raw<MapRecord[]>([]);
  let counts = $state.raw(new Map<string, { places: number; routes: number }>());
  let thumbnails = $state<Record<string, string>>({});
  let destination = $state("new"), mode = $state<ImportMode>("merge"), supplied = $state.raw<File>();
  let receiving = $state(false);
  let version = 0;
  let matching: AbortController | undefined;

  const map = $derived(maps.find((map) => map.id === destination));
  const replace = $derived(!!map && mode === "replace");
  const single = $derived(!maps.length);
  const canImport = $derived(!receiving && !!received && (!!map || !!(received.image || supplied)));
  const shared = $derived(received && t("{places} and {routes}", {
    places: plural(received.manifest.markers.length, "place"), routes: plural(received.manifest.routes.length, "route"),
  }));
  const own = $derived(counts.get(destination));
  const ownCount = $derived(own && own.places + own.routes ? own : undefined);
  const action = $derived(!map
    ? { icon: icons.download, label: t("Import as new map"),
        note: t("Creates a separate map with the shared {items}. Your existing maps stay as they are.", { items: shared ?? "" }) }
    : replace
      ? { icon: icons.rotateRight, label: t("Replace on {name}", { name: displayName(map.name) }), note: ownCount
          ? t("Deletes your {places} and {routes} on this map and keeps only the shared ones. This can’t be undone.", { places: plural(ownCount.places, "place"), routes: plural(ownCount.routes, "route") })
          : t("Uses only the shared places and routes. This map has none of its own yet.") }
      : { icon: icons.merge, label: t("Merge into {name}", { name: displayName(map.name) }), note: ownCount
          ? t("Keeps your {places} and {routes} and adds the new ones. Places you already have only gain new history entries.", { places: plural(ownCount.places, "place"), routes: plural(ownCount.routes, "route") })
          : t("Keeps this map as it is and adds the new ones. Places you already have only gain new history entries.") });

  function clearThumbnails() {
    for (const url of Object.values(thumbnails)) URL.revokeObjectURL(url);
    thumbnails = {};
  }

  export async function openImport(input: Blob) {
    if (receiving) return;
    matching?.abort();
    matching = new AbortController();
    const controller = matching;
    const current = ++version;
    received = undefined;
    maps = [];
    loading = true;
    failure = undefined;
    summary = t("Reading shared file…");
    supplied = undefined;
    imageInput.value = "";
    if (!dialog.open) showDialog(dialog);
    try {
      const parsed = await readShare(input);
      if (current !== version) return;
      const share = parsed.manifest;
      const photos = share.photos?.length ? ` · ${plural(share.photos.length, "photo")}` : "";
      const from = share.from ? `\n${t("Shared by {name}", { name: share.from })}` : "";
      summary = `${displayName(share.map.name)}${from}\n${plural(share.markers.length, "place")}${photos} · ${plural(share.routes.length, "route")} · ${parsed.image ? t("Map image included") : t("Annotations only")}`;
      const available = (await listMaps()).filter((map) => map.status === "ready" && map.width === share.map.width && map.height === share.map.height);
      const exact = await matchingMaps(share, available, controller.signal);
      const states = await Promise.all(exact.map((id) => loadNavigation(id)));
      if (current !== version) return;
      maps = available.filter((map) => exact.includes(map.id));
      counts = new Map(states.map((state) => [state.mapId, { places: state.markers.length, routes: state.routes.filter((route) => !route.draft).length }]));
      received = parsed;
      mode = "merge";
      destination = maps[0]?.id ?? "new";
      clearThumbnails();
      for (const map of maps)
        void payloadStore(map.backend).get(map.id, tileKey(map.levels.length - 1, 0, 0)).then((overview) => {
          if (current === version) thumbnails[map.id] = URL.createObjectURL(overview);
        }, () => {});
    } catch (error) {
      if (current === version) failure = errorMessage(error);
    } finally {
      if (current === version) loading = false;
    }
  }

  async function submit() {
    if (!received || !canImport) return;
    const chosen: ShareDestination = map
      ? { mapId: map.id, mode }
      : { image: received.image ?? supplied, mode: "merge" };
    failure = undefined;
    receiving = true;
    try {
      const result = await importShare(received, chosen);
      dialog.close();
      await imported(result, chosen);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) failure = errorMessage(error);
    } finally {
      receiving = false;
    }
  }

  function closed() {
    version++;
    matching?.abort();
    received = undefined;
    supplied = undefined;
    imageInput.value = "";
    maps = [];
    clearThumbnails();
  }
</script>

<script module lang="ts">
  export interface ShareDestination { mapId?: string; image?: File; mode: ImportMode }
  export interface ShareImportResult { map: MapRecord; added: number; updated?: number; skipped: number; removed?: number }
</script>

{#snippet heading(id: string, text: string, hidden = false)}
  <h3 {id} {hidden} class="text-small font-semibold tracking-label text-muted uppercase">{text}</h3>
{/snippet}

<dialog bind:this={dialog} id="receive-dialog" aria-labelledby="receive-title"
  class="[--accent:var(--neon-view)] [--c:var(--accent)] [--fill-strong:rgb(255_255_255/0.13)]"
  oncancel={(event) => { if (receiving) event.preventDefault(); }} onclose={closed}>
  <DialogHeader id="receive-title" title={t("Import shared map")} icon={icons.download}
    close={{ id: "receive-cancel", onclick: () => dialog.close() }} closeDisabled={receiving} />
  <p id="receive-summary">{summary}</p>
  <p id="receive-loading" role="status" hidden={!loading}>{t("Looking for a matching map…")}</p>
  <div id="receive-content" hidden={!received}>
    {@render heading("receive-destinations-title", t("Add to"), single)}
    <!-- Import: shared files go only onto maps made from the same image, or a new map. -->
    <Rows id="receive-destinations" role="radiogroup" aria-labelledby="receive-destinations-title" class={single ? "mt-16!" : "mt-0!"}>
      {#each [...maps, undefined] as option (option?.id ?? "new")}
        <Row tag="label" label={option ? displayName(option.name) : t("New map")}
          hint={option ? t("Same map") : single ? t("None of your maps match this one") : received?.image ? t("Uses the image in the file") : t("Needs the original map image")}
          class={[single ? "cursor-default" : "has-checked:tint-accent/9", option && "[&_small]:text-neon-add"]}>
          {#snippet leading()}
            <span class={["grid size-36 shrink-0 place-items-center overflow-hidden rounded-sm border [&>svg]:size-18",
              option ? "border-line bg-panel text-muted" : "border-neon-add/40 tint-neon-add/12 text-neon-add"]}>
              {#if option && thumbnails[option.id]}<img alt="" src={thumbnails[option.id]} class="size-full object-cover" />
              {:else}<Icon svg={option ? icons.map : icons.plus} />{/if}
            </span>
          {/snippet}
          <input type="radio" name="receive-destination" value={option?.id ?? "new"} bind:group={destination} hidden={single}
            disabled={receiving} class="m-0 size-20 shrink-0 accent-accent" />
        </Row>
      {/each}
    </Rows>
    <div id="receive-mode-field" hidden={!map}>
      {@render heading("receive-mode-title", t("Your places and routes"))}
      <div role="radiogroup" aria-labelledby="receive-mode-title" class="grid grid-cols-2 gap-4 rounded-pill border border-line bg-white/4 p-4">
        {#each [["merge", icons.merge, t("Merge"), ""], ["replace", icons.rotateRight, t("Replace"), "[--c:var(--danger)]"]] as const as [value, icon, label, tone] (value)}
          <label class={["relative flex min-h-42 cursor-pointer items-center justify-center gap-8 rounded-pill border border-transparent",
            "text-body font-strong text-muted [&>svg]:size-18 has-checked:border-c/45 has-checked:tint-c/18 has-checked:text-text", tone]}>
            <input type="radio" name="receive-mode" {value} bind:group={mode} disabled={receiving}
              class="absolute inset-0 m-0 size-full cursor-pointer opacity-0" /><Icon svg={icon} /><span>{label}</span>
          </label>
        {/each}
      </div>
    </div>
    <p id="receive-note" class={["mt-16 mb-0 text-small leading-roomy", replace && "text-danger"]}>{action.note}</p>
    <label id="receive-image-field" hidden={!!map || !!received?.image} class="my-16 block text-small text-muted">
      {t("Original map image")}
      <input bind:this={imageInput} id="receive-image" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={receiving}
        onchange={(event) => (supplied = event.currentTarget.files?.[0])} />
      <small class="mt-4 block text-small text-muted">{t("Choose the exact original image used by the sender.")}</small>
    </label>
  </div>
  <p id="receive-error" class="text-danger" role="alert" hidden={!failure}>{failure}</p>
  <Actions>
    <Button id="receive-import" variant={replace ? "danger" : "primary"} icon={action.icon} label={action.label}
      disabled={!canImport} onclick={() => void submit()} />
  </Actions>
</dialog>
