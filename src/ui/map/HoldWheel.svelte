<script lang="ts">
  import { icons } from "../icons";
  import Icon from "../kit/Icon.svelte";
  import type { ViewerControls } from "../viewer-controls.svelte";

  // Long-press wheel, centred on the finger: three neon rings, a third each with
  // a small gap between (up-left for a place, up-right back to the last mark,
  // down for the trail), and the one the finger is dragged into glows in its
  // colour, with its name above the wheel.
  let { wheel }: { wheel: ViewerControls["wheel"] } = $props();
  const off = "#3a3e46";
  const parts = [
    { choice: "place", color: "var(--neon-add)", arc: "M-59.3 24A64 64 0 0 1 -8.9 -63.4", at: "-55.4px, -32px", icon: icons.pin },
    { choice: "back", color: "var(--neon-saved)", arc: "M8.9 -63.4A64 64 0 0 1 59.3 24", at: "55.4px, -32px", icon: icons.here },
    { choice: "trail", color: "var(--neon-trail)", arc: "M50.4 39.4A64 64 0 0 1 -50.4 39.4", at: "0px, 64px", icon: icons.trail },
  ] as const;
  const lit = $derived(parts.find((part) => part.choice === wheel.choice)?.color);
  // With no trip under way there is no mark to go back to.
  const dim = (choice: string) => choice === "back" && !wheel.marked;
</script>

<div id="hold-wheel" aria-hidden="true" hidden={!wheel.shown} data-choice={wheel.choice} style:left="{wheel.x}px" style:top="{wheel.y}px"
  class="motion pointer-events-none absolute -mt-86 -ml-86 size-172 rounded-full bg-black/45 [--enter-from:scale(0.92)]">
  <svg viewBox="-86 -86 172 172" class="absolute inset-0 size-full overflow-visible">
    {#each parts as part (part.choice)}
      {@const chosen = part.choice === wheel.choice}
      <path d={part.arc} fill="none" stroke-linecap="round" opacity={dim(part.choice) ? 0.4 : undefined}
        style:stroke={chosen ? part.color : off} style:stroke-width={chosen ? "10px" : "7px"}
        style:filter={chosen ? `drop-shadow(0 0 6px ${part.color})` : undefined}
        class="transition-[stroke,stroke-width] duration-fast ease-out" />
    {/each}
  </svg>
  <!-- Each icon sits on its ring, in the middle of its third. -->
  {#each parts as part (part.choice)}
    {@const chosen = part.choice === wheel.choice}
    <span style:transform="translate({part.at}){chosen ? ' scale(1.2)' : ''}" style:color={chosen ? part.color : undefined}
      style:border-color={chosen ? part.color : off} style:opacity={dim(part.choice) ? 0.5 : undefined}
      class="absolute top-1/2 left-1/2 -mt-18 -ml-18 grid size-36 place-items-center rounded-full border-2 bg-black text-muted
        transition-[transform,color,border-color,opacity] duration-fast ease-out"><Icon svg={part.icon} class="size-20" /></span>
  {/each}
  <!-- Straight above the wheel, where the two upper thirds meet, so the finger
       choosing either of them sits to one side of it. -->
  <strong id="hold-label" style:color={lit}
    class="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 rounded-pill bg-black px-12 py-4 text-body font-semibold
      whitespace-nowrap text-muted empty:hidden">{wheel.label}</strong>
</div>
