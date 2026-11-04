<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../../i18n";
  import { keepFormOpen, showDialog } from "../dialog";
  import { dangerSteps, waterSteps } from "../format";
  import { icons } from "../icons";
  import Actions from "../kit/Actions.svelte";
  import Button from "../kit/Button.svelte";
  import DialogHeader from "../kit/DialogHeader.svelte";
  import HeaderButton from "../kit/HeaderButton.svelte";
  import Icon from "../kit/Icon.svelte";
  import { placeIcon } from "../place-icon";
  import { dangerLevel, markerKinds, type DangerLevel, type WaterLevel } from "../../viewer/navigation";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import LevelScale from "./LevelScale.svelte";
  import PlaceLog from "./PlaceLog.svelte";
  import { formField, readingCard } from "./styles";

  // Place details and editing share a bottom card, within thumb reach. Reading
  // sizes the card to what there is to read; longer details scroll under the
  // fixed header. Editing pins Save to the card's bottom edge; the form scrolls
  // under it. Delete, Move and Edit points share a row above.
  let { controls }: { controls: ViewerControls } = $props();

  const editing = $derived(controls.cardMode === "edit");
  const look = $derived((controls.tick, controls.formKind, controls.formWater, controls.formDanger, controls.cardLook()));
  // A copy each time the controls change, since saving edits the item in place.
  const item = $derived.by(() => {
    controls.tick;
    const shown = controls.viewedItem();
    return shown && { ...shown, photos: shown.photos && [...shown.photos], ...("log" in shown && shown.log && { log: [...shown.log] }) };
  });
  const place = $derived(item && "label" in item ? item : undefined);
  const under = $derived(!editing && item ? controls.cardSubtitle(item) : "");
  const photos = $derived(!editing ? item?.photos ?? [] : []);
  const water = $derived(place?.kind === "flooded" ? place.water : undefined);
  const danger = $derived(place && dangerLevel(place));
  const log = $derived(!!place && (!!place.log?.length || !!place.by));
  // With nothing to read, the card shrinks to its header.
  const empty = $derived(!item?.description && !photos.length && !water && !danger && !log);
  const route = $derived(!!controls.editingRoute);
  const discarding = $derived(controls.discarding === "marker-cancel");
  const armed = $derived(controls.cardDeleteArmed === "marker-delete");

  // Longer details show a chevron over a fade at the bottom until read to the end.
  let details: HTMLElement, more = $state(false);
  const measure = () => (more = details.scrollHeight - details.scrollTop - details.clientHeight > 1);
  $effect(() => {
    controls.tick;
    item;
    measure();
  });
  let photoInput: HTMLInputElement;
  function picked() {
    const files = [...photoInput.files ?? []];
    photoInput.value = "";
    if (files.length) void controls.addPhotos(files);
  }
  const levelButton = "grid min-w-0 place-items-center gap-4 rounded-sm border-[1.5px] py-8 text-small font-semibold text-text transition-colors duration-fast";
</script>

<!-- Slots are laid out at once and filled as photos load, so nothing shifts; a
     photo that can't be read leaves no slot. -->
{#snippet photo(id: string, slot: Snippet<[string | undefined]>)}
  {#await controls.photoURL(id)}{@render slot(undefined)}{:then url}{#if url}{@render slot(url)}{/if}{/await}
{/snippet}

<dialog id="marker-dialog" aria-labelledby="marker-dialog-title" data-mode={controls.cardMode} data-reading={!editing || undefined}
  style:--c={look.color} style:--spot-x={controls.spot ? `${controls.spot.x}px` : undefined}
  style:--spot-y={controls.spot ? `${controls.spot.y}px` : undefined}
  oncancel={keepFormOpen} onclose={() => controls.cardClosed()}
  class={["spot-scrim [--accent:var(--c)] [--enter-from:translateY(32px)_scale(0.98)]",
    editing ? "mb-[max(12px,env(safe-area-inset-bottom))] pb-0" : readingCard]}>
  <DialogHeader id="marker-dialog-title" title={controls.cardTitle} icon={look.icon} class={editing ? "" : "mb-0! shrink-0"}
    close={{ id: "marker-cancel", onclick: () => controls.cancelCard() }} closeLabel={discarding ? t("Discard?") : t("Close")} closeArmed={discarding}>
    {#snippet actions()}
      {#if !editing && place}
        <HeaderButton id="marker-add-entry" icon={icons.history} label={t("Add to history")} onclick={() => controls.openLogEntry()} />
      {/if}
      {#if !editing}
        <HeaderButton id="marker-edit" icon={icons.edit} label={place ? t("Edit place") : t("Edit route")} onclick={() => controls.editViewed()} />
      {/if}
    {/snippet}
    {#snippet subtitle()}
      <!-- How fresh the place is, or how long the route, sits under its title. -->
      <p id="marker-detail-updated" hidden={!under} class="mt-4 mb-0 text-small text-muted">{under}</p>
    {/snippet}
  </DialogHeader>

  <div bind:this={details} id="marker-details" role="region" aria-label={place ? t("Place details") : t("Route details")} hidden={editing || empty}
    onscroll={measure} class="mt-16 min-h-0 overflow-y-auto overscroll-contain select-text">
    <!-- Photos lead the details. Swipe sideways through them; the next one peeks in. -->
    <div id="marker-detail-photos" role="group" aria-label={t("Photos")} hidden={!photos.length}
      class="no-scrollbar mb-12 flex snap-x snap-mandatory gap-8 overflow-x-auto overscroll-x-contain">
      {#each photos as id, index (id)}
        {#snippet slot(url: string | undefined)}
          <button type="button" title={t("View full screen")} onclick={() => controls.showPhotos(photos, index)}
            class="min-w-0 flex-[0_0_100%] cursor-zoom-in snap-start overflow-hidden rounded-md p-0 tint-c/8 not-only:basis-[86%]">
            <img src={url} alt={t("Photo {number} of {total}", { number: index + 1, total: photos.length })} decoding="async"
              class="block h-[min(220px,28dvh)] w-full object-cover" />
          </button>
        {/snippet}
        {@render photo(id, slot)}
      {/each}
    </div>
    <p id="marker-detail-level" hidden={!water && !danger} class="mt-0 mb-12 grid gap-8 text-muted">
      {#if water}<LevelScale kind="flooded" field={t("Water level")} steps={waterSteps} at={water} />
      {:else if danger}<LevelScale kind="unstable" field={t("Danger level")} steps={dangerSteps} at={danger} />{/if}
    </p>
    <p id="marker-detail-description" hidden={!item?.description} class="m-0 whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{item?.description}</p>
    <!-- Spaced from what's shown above it, but not from the top of the details. -->
    {#if log && place}
      <section id="marker-detail-log" aria-labelledby="marker-log-heading" class={item?.description || photos.length || water || danger ? "mt-16" : ""}>
        <h3 id="marker-log-heading" class="m-0 text-small text-muted">{t("History")}</h3>
        <PlaceLog id="marker-log-list" log={place.log ?? []} added={place} />
      </section>
    {/if}
  </div>
  {#if !editing}
    <span aria-hidden="true" class={["pointer-events-none absolute inset-x-0 bottom-0 flex h-72 items-end justify-center bg-[linear-gradient(transparent,var(--bg)_70%)] pb-4",
      "transition-opacity duration-fast", more && !empty ? "opacity-100" : "opacity-0"]}
      ><Icon svg={icons.chevronDown} class={["size-32 text-c [stroke-width:3]", more && !empty && "animate-pulse"].filter(Boolean).join(" ")} /></span>
  {/if}

  <form id="marker-form" hidden={!editing} onsubmit={(event) => { event.preventDefault(); controls.saveCard(); }}>
    <!-- The icon field reads like the name field: the chosen pin and its name;
         tapping it opens every pin, named, in a modal. -->
    <div id="marker-kinds" hidden={route} class={formField}>
      <span id="marker-kind-title">{t("Icon and type")}</span>
      <button type="button" id="marker-kind-toggle" aria-haspopup="dialog" aria-controls="kind-dialog" aria-labelledby="marker-kind-title marker-kind-current"
        onclick={() => showDialog(document.getElementById("kind-dialog") as HTMLDialogElement)}
        class="mt-8 flex min-h-50 w-full items-center gap-12 rounded-sm border border-white/15 bg-bg py-4 pr-16 pl-12 text-start text-body text-text">
        <span id="marker-kind-current" class="flex min-w-0 flex-1 items-center gap-12"
          ><Icon svg={placeIcon(controls.formKind, { water: controls.formWater, danger: controls.formDanger })} class="m-[5.33px] size-32 shrink-0"
          /><span>{(markerKinds[controls.formKind] ?? markerKinds.landmark).label}</span></span>
        <!-- Spelled out in the pin's colour so the choice reads as changeable. -->
        <span class="flex shrink-0 items-center gap-4 text-small font-semibold text-c">{t("Change")}<Icon svg={icons.arrow} class="size-18 rotate-180" /></span>
      </button>
    </div>
    <!-- A flooded place's water level (three big steps, tap the chosen one to
         clear) or a danger place's level (two steps, one always chosen). -->
    {#each [
      { id: "marker-water", title: t("Water level"), steps: waterSteps, shown: !route && controls.formKind === "flooded", at: controls.formWater,
        pick: (level: number) => controls.pickWater(level as WaterLevel), data: "water" },
      { id: "marker-danger", title: t("Danger level"), steps: dangerSteps, shown: !route && controls.formKind === "unstable", at: controls.formDanger,
        pick: (level: number) => controls.pickDanger(level as DangerLevel), data: "danger" },
    ] as picker (picker.id)}
      <div id={picker.id} role="group" aria-labelledby="{picker.id}-title" hidden={!picker.shown} class={formField}>
        <span id="{picker.id}-title">{picker.title}</span>
        <div class="mt-8 grid auto-cols-fr grid-flow-col gap-4">
          {#each picker.steps as step (step.level)}
            {@const pressed = step.level === picker.at}
            <button type="button" data-level={picker.data} aria-pressed={pressed} style:--level={step.color} onclick={() => picker.pick(step.level)}
              class={[levelButton, pressed ? "border-level bg-level/12" : "border-glass-line bg-fill"]}
              ><Icon svg={step.icon} class="m-[4.67px] size-28" /><span>{step.label}</span></button>
          {/each}
        </div>
      </div>
    {/each}
    <label><span>{t("Name")}</span><input id="marker-label" maxlength="100" autocomplete="off" enterkeyhint="next" placeholder={controls.namePlaceholder}
      bind:value={controls.formLabel} onkeydown={(event) => {
        // Next on the name moves on to the description; only Save saves the place.
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        document.getElementById("marker-description")?.focus();
      }} /></label>
    <label><span>{t("Description")}</span><textarea id="marker-description" maxlength="2000" rows="3" bind:value={controls.formDescription}></textarea></label>
    <div id="marker-log-field" hidden={!controls.formLog.length} class={formField}>
      <span id="marker-log-title">{t("History")}</span>
      <PlaceLog id="marker-log-edit" labelledby="marker-log-title" log={controls.formLog} remove={(entry) => controls.removeLogEntry(entry)} />
    </div>
    <div id="marker-photos-field" class={formField}>
      <span id="marker-photos-title">{t("Photos")}</span>
      <ul id="marker-photo-list" aria-labelledby="marker-photos-title" class="no-scrollbar mt-8 mb-0 flex list-none gap-8 overflow-x-auto p-0">
        {#each controls.formPhotos as id, index (id)}
          {#snippet slot(url: string | undefined)}
            <li class="relative flex-none">
              <img src={url} alt={t("Photo {number} of {total}", { number: index + 1, total: controls.formPhotos.length })} decoding="async"
                class="block size-88 rounded-sm object-cover tint-c/8" />
              <button type="button" data-remove aria-label={t("Remove photo {number}", { number: index + 1 })} title={t("Remove photo")}
                onclick={() => controls.removePhoto(id)}
                class="absolute top-4 right-4 grid size-32 place-items-center rounded-full border border-white/25 bg-black/70 p-0 text-text"
                ><Icon svg={icons.close} class="size-16" /></button>
            </li>
          {/snippet}
          {@render photo(id, slot)}
        {/each}
        <!-- Adding is one more tile after the photos, outlined like an empty slot. -->
        <li><button type="button" id="marker-add-photos" disabled={controls.photoJobs > 0}
          aria-label={controls.photoJobs ? t("Adding photos…") : t("Add photos")} title={controls.photoJobs ? t("Adding photos…") : t("Add photos")}
          onclick={() => photoInput.click()}
          class="grid size-88 place-items-center rounded-sm border border-dashed border-c/60 p-0 text-c tint-c/8"
          ><Icon svg={icons.plus} class="size-28" /></button></li>
      </ul>
    </div>
    <input bind:this={photoInput} type="file" id="marker-photo-input" accept="image/*" multiple hidden onchange={picked} />
    {#if controls.editingMarker || route}
      <Actions row>
        <!-- The card's buttons share a row, so the armed label stays short and the button fills red instead. -->
        <Button id="marker-delete" variant="quiet-danger" icon={icons.trash} label={armed ? t("Tap again") : t("Delete")} {armed}
          onclick={() => controls.deleteFromCard()} />
        {#if route}
          <Button id="route-points" variant="quiet" icon={icons.route} label={t("Edit points")} onclick={() => controls.saveThenMove()} />
        {:else}
          <Button id="marker-move" variant="quiet" icon={icons.move} label={t("Move")} onclick={() => controls.saveThenMove()} />
        {/if}
      </Actions>
    {/if}
    <div class="sticky bottom-0 mt-8 bg-bg pt-12 pb-[max(20px,env(safe-area-inset-bottom))]">
      <Button type="submit" id="marker-save" icon={icons.check} label={t("Save")} disabled={!controls.canSave} class="w-full" />
    </div>
  </form>
</dialog>
