<script lang="ts">
  import type { TripMark } from "../viewer-controls.svelte";

  // A trip's marks on one rail: when, where if a place was near, and how far
  // from the mark before. Tapping a row finds that mark on the map.
  let { id, marks, selected, onpick, class: className = "" }:
    { id: string; marks: TripMark[]; selected?: number; onpick: (index: number) => void; class?: string } = $props();
</script>

<ol {id} class={["scroller m-0 max-h-198 min-h-0 list-none overflow-auto overscroll-contain p-0", className]}>
  {#each marks as mark (mark.index)}
    <li class="group">
      <button type="button" data-mark={mark.index} aria-pressed={mark.index === selected} onclick={() => onpick(mark.index)}
        class={["grid min-h-44 w-full grid-cols-[68px_20px_minmax(0,1fr)_auto] items-center gap-x-6 rounded-sm bg-transparent px-8 py-0 text-left",
          "enabled:active:scale-100 enabled:active:bg-white/6", mark.index === selected && "tint-c/16"]}>
        <time class="text-small text-muted tabular-nums">{mark.time}</time>
        <span aria-hidden="true" class="relative self-stretch before:absolute before:inset-y-0 before:left-9 before:w-2 before:bg-c/45
          group-first:before:top-1/2 group-last:before:bottom-1/2 after:absolute after:top-[calc(50%-4px)] after:left-6 after:size-8
          after:rounded-full after:bg-c"></span>
        <span class={["truncate text-body", mark.named ? "font-semibold" : "text-muted"]}>{mark.label}</span>
        <small class="text-small text-muted tabular-nums">{mark.note}</small>
      </button>
    </li>
  {/each}
</ol>
