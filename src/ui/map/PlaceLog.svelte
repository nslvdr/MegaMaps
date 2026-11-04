<script lang="ts">
  import { t } from "../../i18n";
  import type { MapMarker, PlaceLogEntry } from "../../viewer/navigation";
  import { changeLine, logDate } from "../format";
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";

  // A place's history as a timeline, newest first. Each entry shows its kind as
  // an icon on the line (tinted for notes and edits, quiet for visits and when
  // the place was added), who did it when it came from someone else, and its
  // date, then its note or a line per change. Reading ends where the place was
  // added; editing can remove entries.
  let { id, labelledby, log, added, remove }: {
    id: string; labelledby?: string; log: PlaceLogEntry[];
    added?: Pick<MapMarker, "created" | "by">; remove?: (entry: PlaceLogEntry) => void;
  } = $props();
  const kinds = {
    edit: { icon: icons.edit, label: t("Edited"), by: (name: string) => t("Edited by {name}", { name }) },
    note: { icon: icons.note, label: t("Note"), by: (name: string) => t("Note by {name}", { name }) },
    visit: { icon: icons.visit, label: t("Visited"), by: (name: string) => t("Visited by {name}", { name }) },
    added: { icon: icons.added, label: t("Added"), by: (name: string) => t("Added by {name}", { name }) },
  };
  // Latest visit first; entries for the same day keep the newest written on top.
  const entries = $derived(log.map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.date - a.entry.date || b.index - a.index).map(({ entry }) => entry));
  const kindOf = (entry: PlaceLogEntry) => entry.changes ? "edit" : entry.text ? "note" : "visit";
</script>

{#snippet item(kind: keyof typeof kinds, time: number, by: string | undefined, entry?: PlaceLogEntry)}
  <!-- A line from just under this icon to just above the next one. -->
  <li data-kind={kind} class="relative grid grid-cols-[28px_1fr_auto] items-start gap-x-12 pb-12 leading-snug last:pb-0
    not-last:after:absolute not-last:after:top-30 not-last:after:bottom-2 not-last:after:left-[13.5px] not-last:after:w-1 not-last:after:bg-c/40">
    <span class={["grid size-28 place-items-center rounded-full", kind === "visit" || kind === "added" ? "bg-muted/14 text-muted" : "bg-c/16 text-c"]}
      ><Icon svg={kinds[kind].icon} class="size-16" /></span>
    <div>
      <!-- A long nickname wraps; the date keeps its line. -->
      <p data-log="head" class="m-0 flex justify-between gap-8 pt-4 text-small text-muted">
        <strong class="min-w-0 text-text [overflow-wrap:anywhere]">{by ? kinds[kind].by(by) : kinds[kind].label}</strong>
        <time datetime={new Date(time).toISOString()} class="flex-none">{logDate(time)}</time>
      </p>
      {#if entry?.changes}
        <!-- An edit: a line per change, the field muted before what it became. -->
        <ul data-log="changes" class="mt-4 mb-0 list-none p-0">
          {#each entry.changes.map(changeLine) as line, index (index)}
            <li class="flex flex-wrap items-center gap-x-4 text-text [overflow-wrap:anywhere]">
              <span class="mr-4 text-muted">{line.field}</span>{line.from ?? ""}{#if line.from && line.to}<Icon svg={icons.next}
                class="size-14 flex-none text-muted" />{/if}{line.to ?? ""}{line.detail ?? ""}
            </li>
          {/each}
        </ul>
      {:else if entry?.text}
        <p data-log="text" class="mt-4 mb-0 whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{entry.text}</p>
      {/if}
    </div>
    {#if remove && entry}
      <button type="button" data-log="remove" aria-label={t("Remove entry from {date}", { date: logDate(entry.date) })} title={t("Remove entry")}
        onclick={() => remove(entry)} class="-mt-4 -mr-6 grid size-36 place-items-center bg-transparent p-0 text-muted"
        ><Icon svg={icons.close} class="size-18" /></button>
    {/if}
  </li>
{/snippet}

<ol {id} aria-labelledby={labelledby} class="mt-8 mb-0 list-none p-0">
  {#each entries as entry (entry.id)}{@render item(kindOf(entry), entry.date, entry.by, entry)}{/each}
  {#if added}{@render item("added", added.created, added.by)}{/if}
</ol>
