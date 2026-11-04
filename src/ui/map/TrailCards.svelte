<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Actions from "../kit/Actions.svelte";
  import Button from "../kit/Button.svelte";
  import DialogHeader from "../kit/DialogHeader.svelte";
  import HeaderButton from "../kit/HeaderButton.svelte";
  import Icon from "../kit/Icon.svelte";
  import Row from "../kit/Row.svelte";
  import Rows from "../kit/Rows.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import { readingCard } from "./styles";
  import TripLog from "./TripLog.svelte";

  // The trail's cards, read beside the map in its red: a finished trip at a
  // glance, folding open to every mark, and the last mark, whose Edit offers
  // Move and Delete.
  let { controls }: { controls: ViewerControls } = $props();
  const shown = $derived((controls.tick, controls.viewedTrip()));
  const trip = $derived((controls.tick, shown && controls.tripCard(shown)));
  const marks = $derived((controls.tick, shown && controls.tripLogOpen ? controls.tripMarks(shown.points, true) : []));
  const armed = $derived(controls.cardDeleteArmed === "mark-delete");
  const card = [readingCard, "[--c:var(--neon-trail)]"];
</script>

<dialog id="trip-dialog" aria-labelledby="trip-title" data-reading onclose={() => controls.tripClosed()} class={card}>
  <DialogHeader id="trip-title" title={trip?.title ?? ""} icon={icons.trail} class="mb-0! shrink-0" close={{ id: "trip-close", onclick: () => controls.closePlaceDetails() }}>
    {#snippet subtitle()}<p id="trip-times" class="mt-4 mb-0 text-small text-muted">{trip?.times}</p>{/snippet}
    {#snippet actions()}
      <HeaderButton id="trip-route" icon={trip?.saved ? icons.check : icons.route} label={trip?.saved ? t("Saved as route") : t("Save as route")}
        disabled={trip?.saved} onclick={() => controls.saveTripRoute()} />
      <HeaderButton id="trip-edit" icon={icons.edit} label={t("Rename trip")} onclick={() => controls.renameTrip()} />
    {/snippet}
  </DialogHeader>
  <Rows class="flex min-h-0 flex-col">
    <dl class="m-0 grid shrink-0 grid-cols-2">
      {#each trip?.stats ?? [] as stat (stat.id)}
        <div class="border-line p-12 even:border-l nth-[n+3]:border-t">
          <dt class="flex items-center gap-6 text-small text-muted"><Icon svg={stat.icon} class="size-16 flex-none text-c" />{stat.label}</dt>
          <dd id={stat.id} class="mt-4 mb-0 ml-0 text-heading leading-tight font-bold whitespace-nowrap tabular-nums">{stat.value}</dd>
        </div>
      {/each}
    </dl>
    <Row id="trip-log-toggle" class="min-h-48! shrink-0 [&_small]:truncate" icon={icons.pin} tone="var(--neon-trail)" label={trip?.marks ?? ""} hint={trip?.passed}
      hintId="trip-passed" expanded={controls.tripLogOpen} onclick={() => controls.toggleTripLog()} />
    {#if controls.tripLogOpen}
      <TripLog id="trip-log" {marks} selected={controls.tripMark} onpick={(index) => controls.pickTripMark(index)} class="p-4" />
    {/if}
  </Rows>
</dialog>

<dialog id="mark-dialog" aria-labelledby="mark-title" data-reading class={card}>
  <DialogHeader id="mark-title" title={t("Last mark")} icon={icons.trail} class="mb-0! shrink-0" close={{ id: "mark-close", onclick: () => controls.closePlaceDetails() }}>
    {#snippet subtitle()}<p id="mark-time" class="mt-4 mb-0 text-small text-muted">{controls.markTime}</p>{/snippet}
    {#snippet actions()}<HeaderButton id="mark-edit" icon={icons.edit} label={t("Edit mark")} onclick={() => controls.toggleMarkActions()} />{/snippet}
  </DialogHeader>
  <Actions row id="mark-actions" hidden={!controls.markActions} class="motion mt-16! [--enter-from:translateY(12px)]">
    <Button id="mark-delete" variant="quiet-danger" icon={icons.trash} label={armed ? t("Tap again") : t("Delete")} {armed}
      onclick={() => controls.deleteMarkTap()} />
    <Button id="mark-move" variant="quiet" icon={icons.move} label={t("Move")} onclick={() => controls.moveMark()} />
  </Actions>
</dialog>
