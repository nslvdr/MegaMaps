<script lang="ts">
  import { locale, plural, t } from "../i18n";
  import { formatMinutes } from "../viewer/measure";
  import { dayLevel, summarizeActivity, WEEKS, type Activity } from "./activity";
  import { displayName } from "./format";
  import { icons } from "./icons";
  import Icon from "./kit/Icon.svelte";
  // Settings' activity card: a year of trips, one square a day in columns of
  // weeks, then records and totals. Without an `activity` yet, it holds its
  // place with blank bars so Settings doesn't shift once the trips are read.
  let { activity: loaded }: { activity?: Activity } = $props();
  const loading = $derived(!loaded);
  const activity = $derived(loaded ?? summarizeActivity([]));

  const short = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const monthName = new Intl.DateTimeFormat(locale, { month: "short" });
  // A label under the first week of each quarter's month, so they never crowd.
  const months = $derived(Array.from({ length: WEEKS }, (_, week) => new Date(activity.first + week * 7 * 86_400_000))
    .flatMap((date, week, all) => week && date.getMonth() !== all[week - 1]!.getMonth() && date.getMonth() % 3 === 0
      ? [{ week, label: monthName.format(date) }] : []));
  const records: { id: string; icon: string; tone: string; label: string; value?: string; note?: string }[] = $derived(loading ? [
    { id: "longest", icon: icons.longest, tone: "var(--neon-trail)", label: t("Longest") },
    { id: "favourite", icon: icons.map, tone: "var(--neon-add)", label: t("Favourite") },
    { id: "streak", icon: icons.streak, tone: "var(--kind-place)", label: t("Streak") },
  ] : activity.longest && activity.favourite ? [
    { id: "longest", icon: icons.longest, tone: "var(--neon-trail)", label: t("Longest"),
      value: formatMinutes(activity.longest.minutes), note: short.format(activity.longest.started) },
    { id: "favourite", icon: icons.map, tone: "var(--neon-add)", label: t("Favourite"),
      value: displayName(activity.favourite.name), note: plural(activity.favourite.trips, "trip") },
    { id: "streak", icon: icons.streak, tone: "var(--kind-place)", label: t("Streak"), value: plural(activity.streak, "week"),
      note: activity.streak ? t("Ongoing") : t("Best: {weeks}", { weeks: plural(activity.best, "week") }) },
  ] : []);
  const totals = $derived([
    { id: "trips", icon: icons.trail, tone: "var(--neon-trail)", label: t("Trips"), value: activity.trips.toLocaleString(locale) },
    { id: "time", icon: icons.timer, tone: "var(--neon-trail)", label: t("On site"), value: activity.minutes ? formatMinutes(activity.minutes) : "0" },
    { id: "places", icon: icons.places, tone: "var(--kind-place)", label: t("Places"), value: activity.places.toLocaleString(locale) },
    { id: "photos", icon: icons.photos, tone: "var(--neon-saved)", label: t("Photos"), value: activity.photos.toLocaleString(locale) },
  ].map((total) => (loading ? { ...total, value: undefined } : total)));
</script>

<!-- A line-high blank bar standing in for text still loading. -->
{#snippet blank(width: string)}
  <span class="inline-block animate-pulse rounded-[4px] bg-white/8 align-middle" style:width>&nbsp;</span>
{/snippet}

<section id="settings-activity" aria-labelledby="settings-activity-title" aria-busy={loading}
  class="mt-16 rounded-md border border-line bg-[radial-gradient(140%_70%_at_0%_0%,rgb(255_42_42/0.07),transparent_60%)] p-16">
  <div class="flex items-baseline justify-between gap-12">
    <h2 id="settings-activity-title" class="m-0 text-heading font-bold tracking-tight">{t("Past year")}</h2>
    <span id="settings-activity-days" class="text-small text-muted">{#if loading}{@render blank("72px")}{:else}{t("{days} on site", { days: plural(activity.daysOut, "day") })}{/if}</span>
  </div>

  <!-- Columns of weeks, Monday on top; days still to come stay blank. -->
  <div class="mt-14 grid grid-flow-col grid-cols-[repeat(52,1fr)] grid-rows-[repeat(7,auto)] gap-2" aria-hidden="true">
    {#each activity.days as minutes, day (day)}
      <span class={["aspect-square rounded-[2px]", day <= activity.today && "bg-white/6"]}
        style:background={minutes ? "var(--neon-trail)" : undefined} style:opacity={minutes ? dayLevel(minutes) : undefined}
        style:box-shadow={minutes ? "0 0 6px var(--neon-trail)" : undefined}></span>
    {/each}
  </div>
  <div class="mt-8 grid grid-cols-[repeat(52,1fr)] text-small text-muted" aria-hidden="true">
    {#each months as { week, label } (week)}<span class="whitespace-nowrap" style:grid-column-start={week + 1}>{label}</span>{/each}
  </div>

  {#if records.length}
    <div class="mt-14 grid grid-cols-3 gap-8">
      {#each records as record (record.id)}
        <div id="settings-activity-{record.id}" class="min-w-0 rounded-sm border border-line p-10">
          <span class="flex items-center gap-6 text-small text-muted"><span class="flex shrink-0" style:color={record.tone}><Icon svg={record.icon} class="size-14" /></span>{record.label}</span>
          <b class="mt-4 block truncate font-semibold">{#if record.value === undefined}{@render blank("80%")}{:else}{record.value}{/if}</b>
          <small class="block truncate text-small text-muted">{#if record.note === undefined}{@render blank("50%")}{:else}{record.note}{/if}</small>
        </div>
      {/each}
    </div>
  {:else}
    <p class="mt-14 mb-0 text-small leading-roomy text-muted">{t("Start a trip on a map, and your time on site fills this in.")}</p>
  {/if}

  <dl class="m-0 mt-16 grid grid-cols-4 border-t border-line pt-14">
    {#each totals as total (total.id)}
      <div class="flex min-w-0 flex-col gap-2 pl-10 not-first:border-l not-first:border-line">
        <dt class="flex items-center gap-6 text-small text-muted"><span class="flex shrink-0" style:color={total.tone}><Icon svg={total.icon} class="size-14" /></span>{total.label}</dt>
        <dd id="settings-activity-{total.id}" class="m-0 truncate font-semibold tabular-nums">{#if total.value === undefined}{@render blank("60%")}{:else}{total.value}{/if}</dd>
      </div>
    {/each}
  </dl>
</section>
