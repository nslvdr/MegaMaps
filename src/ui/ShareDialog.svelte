<script lang="ts">
  import { showDialog } from "./dialog";
  import { displayName, formatBytes, plural } from "./format";
  import { icons } from "./icons";
  import { placeIcon } from "./place-icon";
  import { shareOrDownload } from "./save-file";
  import { t, errorMessage } from "../i18n";
  import type { MapRecord } from "../types";
  import { routeColor, type NavigationState } from "../viewer/navigation";
  import { exportFile, prepareExport, type PreparedExport } from "../sharing/storage";
  import { track } from "../stats";
  import Actions from "./kit/Actions.svelte";
  import Button from "./kit/Button.svelte";
  import DialogHeader from "./kit/DialogHeader.svelte";
  import Icon from "./kit/Icon.svelte";
  import Row from "./kit/Row.svelte";
  import Rows from "./kit/Rows.svelte";
  import Switch from "./kit/Switch.svelte";

  // Picks what goes in a shared file, then hands it to the system share sheet.
  type Kind = "marker" | "route";
  interface Item { kind: Kind; id: string; name: string; icon: string; detail?: string; checked: boolean }
  let dialog: HTMLDialogElement;
  let mapName = $state(""), loading = $state(false);
  // A note or error is about one file: any change makes a new one, which clears it.
  let failure = $state.raw<{ file?: File; message: string }>(), savedFile = $state.raw<File>();
  let prepared = $state.raw<PreparedExport>();
  let items = $state<Item[]>([]);
  let includeImage = $state(false), exporting = $state(false);
  // Places and routes are picked on their own page so the summary never scrolls.
  let picking = $state<Kind>();
  let version = 0;

  const ofKind = (kind: Kind) => items.filter((item) => item.kind === kind);
  const chosen = $derived(items.filter((item) => item.checked));
  const built = $derived.by(() => {
    if (!prepared) return {};
    try {
      return { file: exportFile(prepared, {
        markers: chosen.filter((item) => item.kind === "marker").map((item) => item.id),
        routes: chosen.filter((item) => item.kind === "route").map((item) => item.id),
        includeImage,
      }) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  });
  const file = $derived(built.file);
  // One place or route on its own is named, confirming what Share picked.
  const title = $derived(chosen.length === 1 && !includeImage ? t("Share {name}", { name: chosen[0]!.name }) : t("Share map"));
  const count = (kind: Kind) => {
    const all = ofKind(kind).length, picked = ofKind(kind).filter((item) => item.checked).length;
    return !all ? t("None saved") : picked === all ? t("All {count}", { count: picked }) : picked ? t("{picked} of {total}", { picked, total: all }) : t("None");
  };
  const error = $derived(failure?.file === file ? failure?.message : built.error);

  export async function openExport(map: MapRecord, state: NavigationState, initial?: { kind: Kind; id: string }) {
    if (exporting) return;
    const current = ++version;
    prepared = undefined;
    items = [];
    picking = undefined;
    mapName = displayName(map.name);
    loading = true;
    failure = undefined;
    if (!dialog.open) showDialog(dialog);
    try {
      const data = await prepareExport(map, state);
      if (current !== version) return;
      includeImage = !initial && data.markers.length + data.routes.length === 0;
      items = [
        ...data.markers.map((item) => ({ kind: "marker" as const, id: item.id, name: item.label, icon: placeIcon(item.kind, item) })),
        // A place's pin says what it is; routes add their length.
        ...data.routes.map((item) => ({ kind: "route" as const, id: item.id, name: item.name,
          icon: icons.route.replace("<svg ", `<svg style="color:${routeColor(state, item.id)}" `), detail: plural(item.points.length, "point") })),
      ].map((item) => ({ ...item, checked: !initial || (initial.kind === item.kind && initial.id === item.id) }));
      prepared = data;
    } catch (error) {
      if (current === version) failure = { message: errorMessage(error) };
    } finally {
      if (current === version) loading = false;
    }
  }

  async function send() {
    if (!file || exporting) return;
    failure = undefined;
    const sent = {
      places: chosen.filter((item) => item.kind === "marker").length,
      routes: chosen.filter((item) => item.kind === "route").length,
      image: includeImage,
    };
    exporting = true;
    const shared = file;
    try {
      // The file is prepared before this tap, preserving native user activation.
      const outcome = await shareOrDownload(shared, dialog);
      if (outcome === "cancelled") return;
      track("share_exported", { ...sent, method: outcome === "saved" ? "download" : "share" });
      if (outcome === "saved") savedFile = shared;
      else dialog.close();
    } catch (error) {
      failure = { file: shared, message: errorMessage(error) };
    } finally {
      exporting = false;
    }
  }

  function pickAll(checked: boolean) {
    for (const item of items) if (item.kind === picking) item.checked = checked;
  }
  function cancel(event: Event) {
    if (exporting) event.preventDefault();
    // Back on a picker page steps back to the summary.
    else if (picking) {
      event.preventDefault();
      picking = undefined;
    }
  }
  function closed() {
    version++;
    prepared = undefined;
    items = [];
    picking = undefined;
  }
  const close = () => dialog.close();
</script>

<!-- Sharing stays in menus and dialogs, leaving the map controls compact. -->
<dialog bind:this={dialog} id="share-dialog" aria-labelledby={picking ? "share-picker-title" : "share-title"}
  class="[--accent:var(--neon-view)] [--c:var(--accent)] [--fill-strong:rgb(255_255_255/0.13)]" oncancel={cancel} onclose={closed}>
  <div id="share-main" hidden={!!picking}>
    <DialogHeader id="share-title" {title} icon={icons.share} close={{ id: "share-cancel", onclick: close }} closeDisabled={exporting} />
    <p class="flex items-center gap-8 text-small"><Icon svg={icons.map} class="size-16" /><span id="share-map-name">{mapName}</span></p>
    <p id="share-loading" role="status" hidden={!loading}>{t("Preparing share…")}</p>
    <div id="share-content" hidden={!prepared}>
      <!-- Summary: one row per part of the file, so it never scrolls. -->
      <Rows>
        {#each [["marker", "share-places", icons.pin, "var(--kind-place)", t("Places")], ["route", "share-routes", icons.route, "var(--kind-route)", t("Routes")]] as const as [kind, id, icon, tone, label] (kind)}
          <Row {id} {icon} {tone} {label} value={count(kind)} valueId="{id}-count" arrow disabled={exporting || !ofKind(kind).length}
            onclick={() => (picking = kind)} />
        {/each}
        <Row tag="label" icon={icons.map} tone="var(--neon-add)" label={t("Map image")} hint={t("Your friend won’t need the original")}>
          <Switch id="share-image" bind:checked={includeImage} disabled={exporting} />
        </Row>
      </Rows>
      <p id="share-size" role="status" aria-live="polite" class="mt-16 mb-0 flex justify-between gap-12 text-small tabular-nums empty:hidden"
        >{#if file && savedFile === file}{t("File saved. Send it from your files app.")}{:else if file}<span
          >{includeImage ? t("With map image") : t("Annotations only")}</span><b class="font-semibold text-text">{formatBytes(file.size)}</b>{/if}</p>
    </div>
    <p id="share-error" class="text-danger" role="alert" hidden={!error}>{error}</p>
    <Actions><Button id="share-send" icon={icons.share} label={t("Share file")} disabled={exporting || !file} onclick={send} /></Actions>
  </div>

  <div id="share-picker" hidden={!picking}>
    <DialogHeader id="share-picker-title" title={picking === "route" ? t("Routes") : t("Places")}
      icon={picking === "route" ? icons.route : icons.pin} close={{ id: "share-picker-close", onclick: close }} closeDisabled={exporting} />
    <button type="button" id="share-back" disabled={exporting} onclick={() => (picking = undefined)}
      class="mb-8 inline-flex min-h-44 items-center gap-2 rounded-md bg-transparent py-8 text-body font-semibold text-accent [&>svg]:size-20"
      ><Icon svg={icons.arrow} /><span>{t("Share map")}</span></button>
    <div class="my-16 flex gap-8 *:flex-1">
      {#each [["share-all", true, icons.check, t("All")], ["share-none", false, icons.close, t("None")]] as const as [id, checked, icon, label] (id)}
        {@const pressed = picking !== undefined && ofKind(picking).every((item) => item.checked === checked)}
        <Button {id} variant={pressed ? "primary" : "secondary"} {pressed} {icon} {label} disabled={exporting}
          class="min-h-44! text-small! [&>svg]:size-18!" onclick={() => pickAll(checked)} />
      {/each}
    </div>
    <div id="share-items" role="group" aria-labelledby="share-picker-title" class="max-h-[50dvh] overflow-y-auto rounded-md border border-line">
      {#each items as item, index (item.kind + item.id)}
        <label hidden={item.kind !== picking}
          class={["flex min-h-58 cursor-pointer items-center gap-12 px-12 py-8 [overflow-wrap:anywhere]",
            items[index - 1]?.kind === item.kind && "border-t border-line"]}>
          <span class="grid size-30 shrink-0 place-items-center [&>svg]:size-26"><Icon svg={item.icon} /></span>
          <span class="min-w-0 flex-1">{item.name}{#if item.detail}<small class="mt-4 block text-small text-muted">{item.detail}</small>{/if}</span>
          <input type="checkbox" value={item.id} data-kind={item.kind} bind:checked={item.checked} disabled={exporting}
            class="size-22 shrink-0 accent-accent" />
        </label>
      {/each}
    </div>
    <Actions><Button id="share-done" icon={icons.check} label={t("Done")} disabled={exporting} onclick={() => (picking = undefined)} /></Actions>
  </div>
</dialog>
