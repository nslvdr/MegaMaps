<script lang="ts">
  import { t } from "../../i18n";
  import { icons } from "../icons";
  import Actions from "../kit/Actions.svelte";
  import Button from "../kit/Button.svelte";
  import Icon from "../kit/Icon.svelte";
  import Row from "../kit/Row.svelte";
  import Rows from "../kit/Rows.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";
  import SavedRows from "./SavedRows.svelte";
  import SectionTitle from "./SectionTitle.svelte";
  import { fieldHelp } from "./styles";
  import TripLog from "./TripLog.svelte";

  // A trip keeps your place on the map as you walk, then stays as a record of
  // where you went, to see what's left to explore. Before the first one: what
  // it is and how to start; once there are trips, that folds away above them.
  // During one: how far it has come, then its marks, then what to do, in the
  // thumb's reach.
  let { controls, hidden }: { controls: ViewerControls; hidden: boolean } = $props();
  // Read again each minute, so "Last mark" stays true.
  const trip = $derived((controls.tick, controls.clockNow, controls.tripSummary()));
  let marksOpen = $state(false);
  const trips = $derived.by(() => (controls.tick, controls.confirming, hidden || trip ? [] : controls.tripRows()));
  const count = $derived((controls.tick, controls.state.trips.length));
  // Newest first: where you just were is what you came for.
  const marks = $derived.by(() => (controls.tick, !hidden && trip && marksOpen ? controls.tripMarks(controls.state.trail, false).reverse() : []));
  const tone = "var(--neon-trail)";
  let howOpen = $state(false);
  const steps = [
    { icon: icons.here, label: t("Tap where you are"), hint: t("Your first mark starts the trip.") },
    { icon: icons.added, label: t("Mark as you walk"), hint: t("The red dot keeps your spot, and your marks draw the way you went.") },
    { icon: icons.tripEnd, label: t("End the trip"), hint: t("It’s kept here, so you can see what’s left to explore.") },
  ];
</script>

{#snippet how()}
  <p class="m-0 text-body leading-normal text-muted">{t("There’s no GPS underground, so you mark your way as you walk. The map then shows where you are and where you’ve been.")}</p>
  <!-- The trail's own dashes run behind the steps' opaque circles. -->
  <ol class="relative mt-8 mb-0 list-none p-0 before:absolute before:inset-y-29 before:left-15 before:border-l-2 before:border-dashed before:border-c/45">
    {#each steps as step (step.label)}
      <Row tag="li" class="px-0!" icon={step.icon} {tone} label={step.label} hint={step.hint} />
    {/each}
  </ol>
{/snippet}

<div id="sheet-trail" {hidden}>
  {#if trip}
    <p class="m-0 flex min-h-48 flex-wrap items-center justify-between gap-x-12 rounded-md border border-line px-12 text-heading leading-tight font-bold tabular-nums">
      <span class="flex items-center gap-8"><Icon svg={icons.measure} class="size-20 text-c" /><span id="trip-walked">{trip.distance}</span></span>
      <span class="flex items-center gap-8"><Icon svg={icons.timer} class="size-20 text-c" /><span id="trip-time">{trip.time}</span></span>
    </p>
    <Rows class="mt-12">
      <Row id="trip-back" class="min-h-48!" icon={icons.here} {tone} label={t("Last mark")} value={trip.last} valueId="trip-last" arrow
        onclick={() => controls.backFromPanel()} />
      <Row id="trip-marks" class="min-h-48!" icon={icons.pin} {tone} label={t("Marks")} value={trip.count} valueId="trip-marks-count" expanded={marksOpen}
        onclick={() => (marksOpen = !marksOpen)} />
      {#if marksOpen}
        <TripLog id="trip-log-live" {marks} onpick={(index) => controls.backFromPanel(index)} class="p-4" />
      {/if}
    </Rows>
    <!-- Like Undo and Done on the task card: the main action on the thumb side. -->
    <Actions row class="mt-12!">
      <Button id="trip-end" variant="quiet" icon={icons.tripEnd} label={t("End trip")} class="[&>svg]:text-c" onclick={() => controls.endTrip()} />
      <Button id="trip-mark" icon={icons.added} label={t("Mark here")} onclick={() => controls.mode("trail")} />
    </Actions>
  {:else}
    {#if !count}
      <h3 id="trip-intro" class="mt-0 mb-8 text-heading leading-tight">{t("Keep your place on the map")}</h3>
      {@render how()}
    {/if}
    <Button id="trip-start" class={["w-full", !count && "mt-12"]} icon={icons.here} label={t("Start trip")} onclick={() => controls.mode("trail")} />
    <p id="trip-hint" class={fieldHelp}>{t("Or long-press the map and drag down. Sharing a map leaves your trips out.")}</p>
    {#if count}
      <Rows class="mt-12">
        <Row id="trip-how" class="min-h-48!" icon={icons.trail} {tone} label={t("How trips work")} expanded={howOpen} onclick={() => (howOpen = !howOpen)} />
      </Rows>
      <div id="trip-how-body" hidden={!howOpen} class="mt-12">{@render how()}</div>
      <SectionTitle id="trip-history-title" icon={icons.history} label={t("Past trips")} count={String(count)} countId="trip-history-count" color={tone} />
      {#if !hidden}
        <SavedRows {controls} id="trip-list" labelledby="trip-history-title" rows={trips} empty="" color={tone} />
      {/if}
    {/if}
  {/if}
</div>
